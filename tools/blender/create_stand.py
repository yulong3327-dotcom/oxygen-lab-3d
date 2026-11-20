"""Rebuild the stand v1 source, GLB and reference render from scratch."""

import argparse
from math import radians
from pathlib import Path
import sys

import bpy
from mathutils import Quaternion, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_asset import export_asset


def collection(name):
    result = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(result)
    return result


def place(obj, name, group, material=None):
    obj.name = name
    for old_group in list(obj.users_collection):
        old_group.objects.unlink(obj)
    group.objects.link(obj)
    if material:
        obj.data.materials.append(material)
    return obj


def material(name, color, metallic=0.0, roughness=0.45):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def finish(obj, radius):
    if radius > 0:
        bevel = obj.modifiers.new("Machined edge", "BEVEL")
        bevel.width = radius
        bevel.segments = 3
        bevel.harden_normals = True
    normal = obj.modifiers.new("Corner normals", "WEIGHTED_NORMAL")
    normal.keep_sharp = True
    return obj


def box(group, name, pos, dims, mat, radius=0.002):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    obj = bpy.context.object
    obj.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(place(obj, name, group, mat), radius)


def cylinder(group, name, start, end, radius, mat, count=32, bevel=0.0007):
    start, end = Vector(start), Vector(end)
    axis = end - start
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=count, radius=radius, depth=axis.length, location=(start + end) / 2
    )
    obj = place(bpy.context.object, name, group, mat)
    obj.rotation_euler = axis.to_track_quat('Z', 'Y').to_euler()
    for face in obj.data.polygons:
        face.use_smooth = len(face.vertices) == 4 and count > 12
    return finish(obj, bevel)


def marker(group, name, position):
    obj = bpy.data.objects.new(name, None)
    group.objects.link(obj)
    obj.location = position
    obj.empty_display_type = 'PLAIN_AXES'
    obj.empty_display_size = 0.018


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def light(group, name, pos, power, size, color):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.shape, data.size, data.color = power, 'DISK', size, color
    obj = bpy.data.objects.new(name, data)
    group.objects.link(obj)
    obj.location = pos
    look_at(obj, (0, 0, 0.16))


def build(output, render):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    asset = collection("ASSET")
    studio = collection("PREVIEW ONLY")

    charcoal = material("Graphite enamel", (0.057, 0.081, 0.101), 0.24, 0.44)
    enamel = material("Blue enamel", (0.065, 0.153, 0.190), 0.18, 0.42)
    steel = material("Brushed steel", (0.53, 0.59, 0.61), 0.68, 0.30)
    rubber = material("Rubber pads", (0.024, 0.027, 0.028), 0, 0.78)
    accent = material("Burnished brass", (0.58, 0.28, 0.086), 0.36, 0.40)
    base_dims = (0.184, 0.146, 0.013)
    box(asset, "Cast iron foot", (0, 0, 0.0135), base_dims, charcoal, 0.005)
    box(asset, "Enamel base plate", (0, 0, 0.020), (0.174, 0.136, 0.005), enamel, 0.002)
    for index, (x, y) in enumerate(((-.072, -.054), (-.072, .054), (.072, -.054), (.072, .054)), 1):
        cylinder(asset, f"Foot pad {index}", (x, y, 0), (x, y, 0.008), .011, rubber)

    x, y = -0.043, 0.030
    cylinder(asset, "Collar", (x, y, .0225), (x, y, .041), .019, charcoal, count=12)
    cylinder(asset, "Collar washer", (x, y, .040), (x, y, .043), .014, steel)
    cylinder(asset, "Upright", (x, y, .040), (x, y, .359), .006, steel)
    cylinder(asset, "Upright cap", (x, y, .354), (x, y, .363), .0073, steel)

    box(asset, "Boss head", (x, y, .26), (.029, .028, .039), enamel, .004)
    cylinder(asset, "Boss lower ferrule", (x, y, .240), (x, y, .244), .011, charcoal)
    cylinder(asset, "Boss upper ferrule", (x, y, .277), (x, y, .281), .011, charcoal)
    cylinder(asset, "Boss set screw", (x - .028, y, .26), (x - .014, y, .26), .0033, steel, count=16)
    cylinder(asset, "Boss screw head", (x - .031, y, .26), (x - .025, y, .26), .008, accent, count=12)
    cylinder(asset, "Clamp arm", (x + .010, y, .26), (.072, 0, .26), .0048, steel)
    box(asset, "Clamp bridge", (.074, 0, .26), (.017, .026, .018), enamel, .0027)

    for sign, side in ((-1, "Front"), (1, "Rear")):
        cylinder(asset, f"{side} pivot", (.074, sign * .010, .253), (.074, sign * .010, .267),
                 .0031, steel, count=16)
        cylinder(asset, f"{side} jaw arm", (.074, sign * .010, .26), (.101, sign * .016, .26),
                 .0036, steel, count=20)
        obj = box(asset, f"{side} jaw shell", (.102, sign * .013, .26), (.019, .009, .011), enamel, .0022)
        obj.rotation_euler.z = sign * radians(20)
        obj = box(asset, f"{side} jaw pad", (.103, sign * .0085, .26), (.016, .003, .009), rubber, .001)
        obj.rotation_euler.z = sign * radians(16)
    cylinder(asset, "Jaw screw shaft", (.074, -.027, .26), (.074, -.012, .26), .0025, steel, count=16)
    cylinder(asset, "Jaw screw knob", (.074, -.032, .26), (.074, -.026, .26), .006, accent, count=12)

    marker(asset, "base", (0, 0, 0))
    marker(asset, "clamp", (.10, 0, .26))

    desk = material("Studio surface", (.67, .73, .73), 0, .76)
    box(studio, "Studio floor", (0, 0, -.0075), (200, 200, 0.015), desk, 0)
    camera = bpy.data.cameras.new("Camera")
    cam_obj = bpy.data.objects.new("Camera", camera)
    studio.objects.link(cam_obj)
    cam_obj.location = (.58, -.76, .50)
    look_at(cam_obj, (0, 0, .170))
    camera.type, camera.ortho_scale = "ORTHO", 0.505
    scene.camera = cam_obj
    scene.world = bpy.data.worlds.new("Studio environment")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes.get("Background").inputs["Color"].default_value = (.58, .65, .70, 1.0)
    scene.world.node_tree.nodes.get("Background").inputs["Strength"].default_value = .37
    light(studio, "Key softbox", (.36, -.47, .70), 23, .39, (1, .93, .86))
    light(studio, "Side fill", (-.48, -.27, .47), 11, .41, (.76, .89, 1))
    light(studio, "Top rear", (-.07, .48, .71), 18, .35, (1, .97, .91))
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 650, 570, 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = "//preview.png"

    bpy.ops.object.select_all(action="DESELECT")
    scene.tool_settings.transform_pivot_point = 'MEDIAN_POINT'
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                view = area.spaces.active
                view.overlay.show_floor = False
                view.overlay.show_axis_x = view.overlay.show_axis_y = False
                view.region_3d.view_perspective = 'ORTHO'
                view.region_3d.view_location = (0, 0, .18)
                view.region_3d.view_distance = .57
                view.region_3d.view_rotation = Quaternion(cam_obj.rotation_euler.to_quaternion())
                view.shading.color_type = 'MATERIAL'
    for obj in studio.objects:
        obj.hide_set(True)

    output.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(output / "stand.blend"), compress=True)
    export_asset(output / "stand.glb")
    if render:
        # View-layer hiding keeps the studio out of the modeling view, not the render.
        bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    repo = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=repo / "assets" / "stand" / "v1")
    parser.add_argument("--skip-render", action="store_true")
    opts = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    build(opts.output_dir.resolve(), not opts.skip_render)
