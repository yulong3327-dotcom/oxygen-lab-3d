"""Turn the oxygen bench's local-space mesh snapshot into Blender and GLB assets."""

import argparse
import json
import re
import sys
from math import isfinite
from pathlib import Path

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_asset import export_asset


def to_blender(xyz):
    x, y, z = xyz
    return (x, -z, y)


def vecs(values):
    if len(values) % 3 or any(not isfinite(value) for value in values):
        raise ValueError("Expected finite triples")
    return [to_blender(values[i:i + 3]) for i in range(0, len(values), 3)]


def group(name):
    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    return collection


def material(part):
    name = part["name"]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    rgb = tuple(part["color"])
    opacity = max(0.04, min(1.0, part["alpha"]))
    is_glass = part.get("glass", False)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = part["roughness"]
    bsdf.inputs["Metallic"].default_value = part["metalness"]
    if is_glass:
        # Match the browser's edge-lit glass with an exportable transmissive surface.
        rgb = tuple(.67 + .33 * c for c in rgb)
        bsdf.inputs["IOR"].default_value = 1.46
        bsdf.inputs["Transmission Weight"].default_value = .94
        bsdf.inputs["Roughness"].default_value = .13
        mat.use_backface_culling = True
    else:
        bsdf.inputs["Alpha"].default_value = opacity
        if opacity < .999:
            mat.surface_render_method = 'BLENDED'
            mat.use_transparency_overlap = False
    mat.diffuse_color = (*rgb, .36 if is_glass else opacity)
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    return mat


def import_part(part, collection):
    name = part["name"]
    vertices = vecs(part["positions"])
    indices = part.get("indices")
    if indices is None:
        indices = range(len(vertices))
    if not vertices or len(indices) % 3 or any(not isinstance(i, int) or not 0 <= i < len(vertices) for i in indices):
        raise ValueError(f"Invalid triangle data: {name}")
    faces = [face for face in zip(indices[0::3], indices[1::3], indices[2::3]) if len(set(face)) == 3]
    if not faces:
        raise ValueError(f"No triangles in {name}")
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.validate()
    normals = part.get("normals")
    if normals:
        normals = vecs(normals)
        if len(vertices) != len(normals):
            raise ValueError(f"Normal count does not match vertex count: {name}")
        for polygon in mesh.polygons:
            polygon.use_smooth = True
        mesh.normals_split_custom_set_from_vertices(normals)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.data.materials.append(material(part))
    return vertices


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def area_light(collection, name, target, spread, offset, power, tint=(1, 1, 1)):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = power * spread ** 2
    data.shape = 'DISK'
    data.size = spread * 1.1
    data.color = tint
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.location = target + spread * Vector(offset)
    look_at(obj, target)


def add_studio(scene, vertices):
    studio = group("PREVIEW ONLY")
    lo = Vector(tuple(min(axis) for axis in zip(*vertices)))
    hi = Vector(tuple(max(axis) for axis in zip(*vertices)))
    center = (lo + hi) / 2
    spread = max(hi - lo)
    if spread <= 0:
        raise ValueError("Asset has zero physical size")

    direction = Vector((1.6, -4.4, 2.65)).normalized()
    rotation = (-direction).to_track_quat('-Z', 'Y')
    hor = rotation @ Vector((1, 0, 0))
    vert = rotation @ Vector((0, 1, 0))
    points = [Vector(pos) - center for pos in vertices]
    xs = [point.dot(hor) for point in points]
    ys = [point.dot(vert) for point in points]
    target = center + hor * ((max(xs) + min(xs)) / 2) + vert * ((max(ys) + min(ys)) / 2)
    aspect = 480 / 420
    view = max(max(xs) - min(xs), aspect * (max(ys) - min(ys))) * 1.36

    cam = bpy.data.cameras.new("Asset Camera")
    cam.type = 'ORTHO'
    cam.ortho_scale = view
    cam.clip_start = spread / 300
    cam.clip_end = spread * 40
    camera = bpy.data.objects.new("Asset Camera", cam)
    studio.objects.link(camera)
    camera.location = target + direction * (spread * 3.6)
    camera.rotation_euler = rotation.to_euler()
    scene.camera = camera

    floor_mesh = bpy.data.meshes.new("Studio Floor")
    scale = spread * 20
    floor_mesh.from_pydata([(-scale, -scale, 0), (scale, -scale, 0), (scale, scale, 0), (-scale, scale, 0)], [], [(0, 1, 2, 3)])
    floor = bpy.data.objects.new("Studio Floor", floor_mesh)
    studio.objects.link(floor)
    floor.location = (center.x, center.y, lo.z - spread * .015)
    floor_mat = bpy.data.materials.new("Neutral gray studio floor")
    floor_mat.use_nodes = True
    floor_bsdf = floor_mat.node_tree.nodes["Principled BSDF"]
    floor_bsdf.inputs["Base Color"].default_value = (.24, .29, .34, 1.0)
    floor_bsdf.inputs["Roughness"].default_value = .82
    floor.data.materials.append(floor_mat)

    scene.world = bpy.data.worlds.new("Neutral Studio")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes["Background"].inputs
    background["Color"].default_value = (.63, .72, .84, 1.0)
    background["Strength"].default_value = .46
    area_light(studio, "Key softbox", center, spread, (-1.6, -2.0, 2.6), 570, (1.0, .95, .86))
    area_light(studio, "Side softbox", center, spread, (1.9, -.8, 1.5), 410, (.78, .90, 1))
    area_light(studio, "Rim softbox", center, spread, (-.6, 1.7, 1.8), 760)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 12
    scene.cycles.use_denoising = True
    scene.cycles.transmission_bounces = 6
    scene.render.resolution_x, scene.render.resolution_y = 480, 420
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = "//preview.png"
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                space = area.spaces.active
                space.overlay.show_floor = False
                space.overlay.show_axis_x = space.overlay.show_axis_y = False
                space.shading.color_type = 'MATERIAL'
                space.region_3d.view_perspective = 'ORTHO'
                space.region_3d.view_location = target
                space.region_3d.view_distance = view * 1.6
                space.region_3d.view_rotation = rotation
    for obj in studio.objects:
        obj.hide_set(True)


def build(asset, output, overwrite, skip_render):
    ident = asset["id"]
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", ident):
        raise ValueError(f"Invalid asset ID: {ident}")
    version = asset.get("version", 1)
    if type(version) is not int or version < 1:
        raise ValueError(f"Invalid asset version: {version}")
    dest = output / ident / f"v{version}"
    source = dest / f"{ident}.blend"
    model = dest / f"{ident}.glb"
    preview = dest / "preview.png"
    if not overwrite and any(path.exists() for path in (source, model, preview)):
        raise FileExistsError(f"Version already exists. Use a new version or --overwrite: {dest}")
    dest.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene["asset_id"] = ident
    scene["asset_version"] = version
    collection = group("ASSET")
    vertices = []
    for part in asset["parts"]:
        vertices.extend(import_part(part, collection))
    if not vertices or not asset["anchors"]:
        raise ValueError(f"Missing geometry or anchors in {ident}")
    spread = max(max(axis) - min(axis) for axis in zip(*vertices))
    for name, coordinates in asset["anchors"].items():
        anchor = bpy.data.objects.new(name, None)
        anchor.location = to_blender(coordinates)
        anchor.empty_display_type = 'PLAIN_AXES'
        anchor.empty_display_size = spread * .10
        collection.objects.link(anchor)
    add_studio(scene, vertices)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
    export_asset(model)
    if not skip_render:
        bpy.ops.render.render(write_still=True)
        if not preview.is_file():
            raise RuntimeError(f"Preview rendering did not finish: {preview}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--only", nargs="+")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--skip-render", action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    assets = json.loads(args.input.read_text(encoding="utf-8"))["assets"]
    if args.only:
        names = {asset["id"] for asset in assets}
        if set(args.only) - names:
            raise ValueError(f"Unknown asset(s): {', '.join(sorted(set(args.only) - names))}")
        assets = [asset for asset in assets if asset["id"] in args.only]
    for asset in assets:
        build(asset, args.output_root.resolve(), args.overwrite, args.skip_render)


if __name__ == '__main__':
    main()
