"""Build the alcohol lamp candidate, its GLB, and an original studio render."""

import argparse
from math import cos, sin, tau
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from create_stand import collection, look_at, marker
from export_asset import export_asset


def material(name, rgb, roughness, ior=1.46, transmission=0):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*rgb, .25 if transmission else 1)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*rgb, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["IOR"].default_value = ior
    shader.inputs["Transmission Weight"].default_value = transmission
    return result, shader


def mesh(group, name, verts, faces, mat):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    group.objects.link(obj)
    data.materials.append(mat)
    for polygon in data.polygons:
        polygon.use_smooth = True
    return obj


def revolved(group, name, profile, mat, sides=96, lean=0):
    """Revolve from the bottom up across the outside and back down the inside."""
    verts, rings = [], []
    for radius, height in profile:
        if not radius:
            rings.append([len(verts)])
            verts.append((lean * height ** 2, 0, height))
        else:
            rings.append(list(range(len(verts), len(verts) + sides)))
            verts += [(radius*cos(tau*j/sides)+lean*height**2,
                       radius*sin(tau*j/sides), height) for j in range(sides)]
    faces = []
    for a, b in zip(rings, rings[1:]):
        for j in range(sides):
            k = (j + 1) % sides
            if len(a) == 1:
                faces.append((a[0], b[k], b[j]))
            elif len(b) == 1:
                faces.append((a[j], a[k], b[0]))
            else:
                faces.append((a[j], a[k], b[k], b[j]))
    return mesh(group, name, verts, faces, mat)


def wick_position(t):
    a, b = Vector((-.031, -.010, .010)), Vector((-.002, -.005, .019))
    c, d = Vector((0, .003, .057)), Vector((.001, .0004, .095))
    u = 1 - t
    return u**3*a + 3*t*u*u*b + 3*t*t*u*c + t**3*d


def strand(group, name, phase, mat, radius=.00061, winding=.00168, top=1):
    verts, faces, rows, sides = [], [], 420, 7
    for i in range(rows+1):
        t = top*i/rows
        center = wick_position(t)
        tangent = (wick_position(t+.0001)-wick_position(t-.0001)).normalized()
        right = Vector((0, 1, 0)).cross(tangent).normalized()
        up = tangent.cross(right)
        spin = tau*19.0*t+phase
        offset = winding*(cos(spin)*right+sin(spin)*up)
        for j in range(sides):
            angle = tau*j/sides
            n = radius*(cos(angle)*right+sin(angle)*up)
            verts.append(center+offset+n)
    for i in range(rows):
        for j in range(sides):
            k = (j+1) % sides
            faces.append((i*sides+j, i*sides+k, (i+1)*sides+k, (i+1)*sides+j))
    faces.extend((tuple(reversed(range(sides))), tuple(range(rows*sides, (rows+1)*sides))))
    return mesh(group, name, verts, faces, mat)


def softbox(group, name, target, pos, power, width, height, rgb=(1,1,1)):
    data = bpy.data.lights.new(name, "AREA")
    data.energy, data.shape, data.size, data.size_y, data.color = power, "RECTANGLE", width, height, rgb
    obj = bpy.data.objects.new(name, data)
    group.objects.link(obj)
    obj.location = pos
    look_at(obj, target)


def preview_flame(group):
    # The flame belongs to the photographed pose, not the exported reusable lamp.
    flame, _ = material("Flame preview", (1,.35,.03), .64)
    nodes = flame.node_tree.nodes
    links = flame.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 2.0
    mix = nodes.new("ShaderNodeMixShader")
    tex = nodes.new("ShaderNodeTexCoord")
    separate = nodes.new("ShaderNodeSeparateXYZ")
    color = nodes.new("ShaderNodeValToRGB")
    stops = [(0, (.012,.075,.95,1)), (.10, (.07,.29,1,1)), (.24, (1,.29,.016,1)),
             (.51, (1,.69,.082,1)), (.69, (1,.81,.24,1)), (1, (1,.41,.065,1))]
    for element in list(color.color_ramp.elements)[1:]:
        color.color_ramp.elements.remove(element)
    for i, (pos, rgba) in enumerate(stops):
        element = color.color_ramp.elements.new(pos) if i else color.color_ramp.elements[0]
        element.position, element.color = pos, rgba
    color.color_ramp.interpolation = 'EASE'
    opacity = nodes.new("ShaderNodeValToRGB")
    opacity.color_ramp.elements[0].color = (.32,.32,.32,1)
    opacity.color_ramp.elements[1].color = (0,0,0,1)
    opacity.color_ramp.elements.new(.18).color = (.89,.89,.89,1)
    opacity.color_ramp.elements.new(.58).color = (.97,.97,.97,1)
    opacity.color_ramp.interpolation = 'EASE'
    facing = nodes.new("ShaderNodeLayerWeight")
    feather = nodes.new("ShaderNodeMapRange")
    feather.inputs["To Min"].default_value = 1
    feather.inputs["To Max"].default_value = .19
    opacity_at_edge = nodes.new("ShaderNodeMath")
    opacity_at_edge.operation = "MULTIPLY"
    links.new(tex.outputs["Generated"], separate.inputs[0])
    links.new(separate.outputs["Z"], color.inputs[0])
    links.new(separate.outputs["Z"], opacity.inputs[0])
    links.new(color.outputs[0], emission.inputs[0])
    links.new(facing.outputs["Facing"], feather.inputs["Value"])
    links.new(feather.outputs[0], opacity_at_edge.inputs[0])
    links.new(opacity.outputs[0], opacity_at_edge.inputs[1])
    links.new(opacity_at_edge.outputs[0], mix.inputs[0])
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(emission.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], out.inputs[0])
    shape = [(0,0),(.003,.0006),(.0047,.0028),(.0058,.006),(.0066,.011),(.0063,.016),
             (.0054,.022),(.0040,.028),(.0025,.034),(.0013,.039),(.0005,.042),(0,.043)]
    obj = revolved(group, "Flame (preview only)", shape, flame, sides=48, lean=1.25)
    obj.location = (.0008, .0003, .0917)
    core, core_shader = material("Flame inner glow (preview only)", (1,.56,.043), .84)
    core_shader.inputs["Emission Color"].default_value = (1,.78,.31,1)
    core_shader.inputs["Emission Strength"].default_value = 2.3
    heart = revolved(group, "Flame inner glow (preview only)", [
        (0,0),(.00155,.001),(.0027,.0037),(.0030,.008),(.00265,.014),
        (.00165,.0195),(.00065,.022), (0,.024)
    ], core, sides=40, lean=1.25)
    heart.location = (.0009,.0003,.100)


def build(output, render):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1
    asset, studio = collection("ASSET"), collection("PREVIEW ONLY")
    glass, glass_shader = material("Clear pressed glass", (.984,.992,.994), .035, 1.474, 1)
    glass_shader.inputs["Coat Weight"].default_value = .10
    glass_shader.inputs["Coat Roughness"].default_value = .062
    liquid, _ = material("Clear alcohol", (.99,.995,.995), .024, 1.36, 1)
    porcelain, porcelain_shader = material("Satin white porcelain", (.84,.88,.865), .25)
    porcelain_shader.inputs["Coat Weight"].default_value = .24
    porcelain_shader.inputs["Coat Roughness"].default_value = .24
    cotton, cotton_shader = material("Cotton wick core", (.56,.51,.42), .83)
    cotton_shader.inputs["Sheen Weight"].default_value = .30
    thread, thread_shader = material("Twisted cotton plies", (.76,.72,.62), .81)
    thread_shader.inputs["Sheen Weight"].default_value = .42
    char, _ = material("Darkened wick end", (.052,.032,.019), .94)

    # Bottle profile includes a thick concave foot, round shoulder, ridged neck,
    # and the inner wall returning to the floor of the reservoir.
    body_profile = [
        (0,.0022), (.021,.0022), (.028,.0015), (.032,.0004), (.034,0),
        (.036,.0007), (.038,.0022), (.0394,.0046), (.041,.010),
        (.043,.016), (.045,.024), (.0464,.031), (.0466,.036),
        (.0458,.041), (.044,.045), (.0416,.0481), (.038,.0505),
        (.033,.0534), (.027,.0573), (.0207,.0618), (.0161,.0658),
        (.0145,.069), (.0134,.073), (.0125,.0782), (.0124,.0812),
        (.0136,.082), (.0141,.0834), (.0141,.0859), (.0135,.087),
        (.0124,.0875), (.0109,.0872), (.0099,.0862), (.0097,.0838),
        (.0101,.0782), (.0111,.0735), (.0126,.0685), (.0147,.0645),
        (.019,.0601), (.025,.0558), (.031,.0517), (.0366,.0483),
        (.0403,.0458), (.0426,.0428), (.0443,.0388), (.0445,.0356),
        (.0441,.031), (.0426,.024), (.0406,.016), (.0387,.010),
        (.0366,.0073), (.034,.0063), (.030,.0056), (.023,.0056), (0,.0056),
    ]
    revolved(asset, "Glass reservoir", body_profile, glass)
    revolved(asset, "Alcohol and curved meniscus", [
        (0,.0059), (.022,.0059), (.030,.0059), (.034,.0066), (.0361,.0076),
        (.0383,.0101), (.0402,.016), (.0422,.024), (.0437,.031), (.0441,.0356),
        (.04405,.0382), (.0439,.03865), (.0435,.03832), (.0427,.03792),
        (.0414,.03765), (.0392,.03750), (.033,.03746), (.025,.03745), (0,.03745)
    ], liquid)
    revolved(asset, "Porcelain wick collar", [
        (.0046,.0835), (.0092,.0835), (.0103,.0842), (.0112,.0869),
        (.0115,.0888), (.0112,.090), (.0099,.0914), (.0081,.092),
        (.004,.0923), (.0031,.0916), (.0031,.085), (.0046,.0835)
    ], porcelain)
    strand(asset, "Cotton wick", 0, cotton, .00185, 0)
    for i in range(6):
        strand(asset, f"Cotton ply {i+1}", tau*i/6, thread, top=.988)
    burnt_tip = revolved(asset, "Darkened wick tip", [
        (0,0), (.00162,0), (.002,.0008), (.00157,.0022), (.00105,.0027), (0,.003)
    ], char, sides=36)
    burnt_tip.location = (.001, .0004, .093)

    cap = revolved(asset, "Porcelain snuffer cap", [
        (.0162,0), (.0174,0), (.0182,.0008), (.0182,.0021), (.0175,.0034),
        (.0172,.0100), (.0168,.0213), (.0161,.0278), (.0148,.0333),
        (.0131,.0372), (.0109,.0400), (.0078,.0422), (.0047,.0433), (0,.0438),
    ], porcelain)
    # The recess is parented to the cap so it follows the removable shell.
    inside = revolved(asset, "Snuffer inner wall", [
        (0,.0408), (.0044,.04065), (.0074,.0397), (.0101,.0377), (.0121,.0351),
        (.0133,.0314), (.0145,.0257), (.0151,.0195), (.0156,.0077),
        (.0157,.0021), (.0162,0),
    ], porcelain)
    cap.location = (-.068,-.030,0)
    inside.parent = cap
    marker(asset, "base", (0,0,0))
    marker(asset, "wick", (.001,.0004,.096))
    marker(asset, "cap-seat", (0,0,.084))
    marker(asset, "cap-rest", (-.068,-.030,0))

    floor, _ = material("Studio floor", (.55,.63,.67), .58)
    mesh(studio, "Stage", [(-2,-2,-.00002), (2,-2,-.00002), (2,2,-.00002), (-2,2,-.00002)],
         [(0,1,2,3)], floor)
    preview_flame(studio)
    camera = bpy.data.cameras.new("Camera")
    cam = bpy.data.objects.new("Camera", camera)
    studio.objects.link(cam)
    cam.location = (.119,-.298,.139)
    look_at(cam, (-.018,0,.066))
    camera.type, camera.ortho_scale, camera.clip_start = "ORTHO", .200, .001
    scene.camera = cam
    scene.world = bpy.data.worlds.new("Studio environment")
    scene.world.use_nodes = True
    world = scene.world.node_tree.nodes.get("Background")
    world.inputs["Color"].default_value = (.53,.66,.77,1)
    world.inputs["Strength"].default_value = .29
    target = (0,0,.052)
    softbox(studio, "Main softbox", target, (-.15,-.14,.27), 12, .14, .26, (1,.94,.87))
    softbox(studio, "Glass rim strip", target, (.13,.04,.15), 8, .065, .225, (.81,.91,1))
    softbox(studio, "Overhead fill", target, (-.025,.105,.265), 6, .18, .19, (1,.97,.92))
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 22
    scene.cycles.transmission_bounces = 12
    scene.cycles.max_bounces = 14
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 700, 720, 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = "//preview.png"

    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                view = area.spaces.active
                view.overlay.show_floor = False
                view.overlay.show_axis_x = view.overlay.show_axis_y = False
                view.region_3d.view_perspective = "ORTHO"
                view.region_3d.view_location = (-.018,0,.053)
                view.region_3d.view_distance = .26
                view.region_3d.view_rotation = cam.rotation_euler.to_quaternion()
                view.shading.color_type = "MATERIAL"
                view.clip_start = .001
    for obj in studio.objects:
        obj.hide_set(True)
    output.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(output/"alcohol-lamp.blend"), compress=True)
    export_asset(output/"alcohol-lamp.glb")
    if render:
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    repo = Path(__file__).resolve().parents[2]
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--output-dir", type=Path, default=repo/"assets"/"alcohol-lamp"/"v1")
    args.add_argument("--skip-render", action="store_true")
    opts = args.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    build(opts.output_dir.resolve(), not opts.skip_render)
