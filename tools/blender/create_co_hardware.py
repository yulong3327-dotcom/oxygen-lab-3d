"""Build and render the reusable hardware for the virtual CO reduction lab."""

import argparse
from math import atan2, cos, sin, pi, tau
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from create_alcohol_lamp import material, mesh, revolved, softbox
from create_stand import collection, look_at, marker
from export_asset import export_asset


def surface(name, color, roughness=.35, metallic=0):
    mat, shader = material(name, color, roughness)
    shader.inputs["Metallic"].default_value = metallic
    return mat


def attach(obj, group, name, mat):
    for current in tuple(obj.users_collection):
        current.objects.unlink(obj)
    group.objects.link(obj)
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def bevel(obj, radius):
    edge = obj.modifiers.new("Rounded edges", "BEVEL")
    edge.width, edge.segments = radius, 3
    normals = obj.modifiers.new("Weighted corners", "WEIGHTED_NORMAL")
    normals.keep_sharp = True
    return obj


def block(group, name, position, dimensions, mat, radius=.001):
    bpy.ops.mesh.primitive_cube_add(size=1, location=position)
    obj = attach(bpy.context.object, group, name, mat)
    for vertex in obj.data.vertices:
        for axis in range(3):
            vertex.co[axis] *= dimensions[axis]
    return bevel(obj, radius)


def rod(group, name, a, b, radius, mat, vertices=40):
    a, b = Vector(a), Vector(b)
    direction = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius,
                                       depth=direction.length, location=(a+b)*.5)
    obj = attach(bpy.context.object, group, name, mat)
    obj.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
    for poly in obj.data.polygons:
        if len(poly.vertices) == 4:
            poly.use_smooth = True
    return bevel(obj, radius*.11)


def path_tube(group, name, samples, mat, sides=20):
    """Sweep radii across a path in Blender's XZ plane."""
    verts, faces = [], []
    for i, (x, z, radius) in enumerate(samples):
        xa, za, _ = samples[max(0, i-1)]
        xb, zb, _ = samples[min(len(samples)-1, i+1)]
        normal = Vector((-(zb-za), 0, xb-xa)).normalized()
        for j in range(sides):
            angle = tau*j/sides
            verts.append(Vector((x, radius*cos(angle), z)) + normal * (radius*sin(angle)))
    for i in range(len(samples)-1):
        for j in range(sides):
            k = (j+1) % sides
            faces.append((i*sides+j, i*sides+k, (i+1)*sides+k, (i+1)*sides+j))
    faces.extend((tuple(reversed(range(sides))), tuple(range(len(verts)-sides, len(verts)))))
    return mesh(group, name, verts, faces, mat)


def nameplate(group, body, position, size, mat):
    text = bpy.data.curves.new("CO lettering", "FONT")
    text.body, text.align_x, text.align_y = body, "CENTER", "CENTER"
    text.size, text.extrude = size, .00013
    obj = bpy.data.objects.new("Gas marking", text)
    group.objects.link(obj)
    obj.location, obj.rotation_euler = position, (pi/2, 0, 0)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.data.materials.append(mat)


def flame(asset, name, position, height, width, colors, lean=0, down=False):
    """Two nested emissive surfaces share one named visibility node."""
    parent = bpy.data.objects.new(name, None)
    asset.objects.link(parent)
    parent.location = position
    if down:
        parent.rotation_euler.x = pi
    profile = [(0,0),(.50,.025),(.81,.09),(1,.24),(.88,.43),(.60,.64),
               (.34,.81),(.14,.94),(0,1)]
    for part, radius, tall, rise, rgb in (
        ("shell", 1, 1, 0, colors[0]),
        ("core", .65, .66, .008, colors[1]),
    ):
        mat, shader = material(f"{name} {part}", rgb, .57)
        shader.inputs["Emission Color"].default_value = (*rgb,1)
        shader.inputs["Emission Strength"].default_value = .92
        if part == "shell":
            shader.inputs["Alpha"].default_value = .52
            mat.surface_render_method = 'BLENDED'
        obj = revolved(asset, f"{name} {part}", [(r*width*radius,z*height*tall)
                       for r,z in profile], mat, sides=40, lean=lean)
        obj.parent = parent
        obj.location.z = rise


def gas_bag(asset):
    rubber = surface("Ochre rubber", (.64,.34,.048), .36)
    seam = surface("Molded seam and collar", (.35,.18,.022), .58)
    hose = surface("Honey-colored hose", (.68,.44,.095), .49)
    metal = surface("Nickel valve body", (.41,.47,.51), .32, .56)
    brass = surface("Hose ferrules", (.61,.43,.15), .32, .66)
    blue = surface("Valve handle", (.11,.23,.27), .37)
    ink = surface("Dark marking", (.07,.10,.11), .76)
    badge = surface("Warm label plate", (.87,.81,.61), .65)

    # A wrapped surface with a smooth pinch into the shoulder and neck.
    verts, faces, rows, sides = [], [], 65, 56
    for i in range(rows):
        t = pi*i/(rows-1)
        x = -.003 - .0515*cos(t) + .009 * (i/(rows-1))**4
        body = sin(t)**.85
        for j in range(sides):
            a = tau*j/sides
            wrinkle = 1+.014*cos(7*a+2.5*t)*sin(t)**2
            verts.append((x, .024*body*wrinkle*cos(a), .030*body*wrinkle*sin(a)))
    for i in range(rows-1):
        for j in range(sides):
            k = (j+1) % sides
            faces.append((i*sides+j, i*sides+k, (i+1)*sides+k, (i+1)*sides+j))
    mesh(asset, "Inflated rubber bag", verts, faces, rubber)
    rod(asset, "Molded neck", (.048,0,0), (.068,0,0), .0097, rubber)
    rod(asset, "Neck lip", (.058,0,0), (.067,0,0), .0102, seam)
    rod(asset, "Bag coupling", (.066,0,0), (.080,0,0), .0072, brass, 12)
    rod(asset, "Valve body", (.080,0,0), (.110,0,0), .0075, metal, 12)
    rod(asset, "Valve stem", (.095,0,.003), (.095,0,.019), .0042, metal, 24)
    block(asset, "ValveHandle", (.095,0,.019), (.020,.009,.006), blue, .0015)
    rod(asset, "Valve outlet ferrule", (.110,0,0), (.123,0,0), .00565, brass, 12)
    points = [(.116 + (.222-.116)*i/32, -.007*sin(pi*i/32)**2, .00415) for i in range(33)]
    path_tube(asset, "Flexible gas line", points, hose)
    rod(asset, "Reactor inlet coupling", (.213,0,0), (.230,0,0), .0050, brass, 20)
    block(asset, "CO label", (-.007,-.0246,.0034), (.034,.0015,.020), badge, .0006)
    nameplate(asset, "CO", (-.007,-.0256,.0034), .0138, ink)
    marker(asset, "center", (0,0,0))
    marker(asset, "valve", (.095,0,.019))
    marker(asset, "outlet", (.230,0,0))
    return (.088,0,0), .337, (.22,-1,.23)


def blowtorch(asset):
    brass = surface("Burnished brass body", (.63,.32,.065), .32, .62)
    brass_dark = surface("Threaded brass", (.40,.23,.057), .39, .63)
    bright = surface("Polished edges", (.79,.48,.13), .27, .63)
    steel = surface("Nickel burner crown", (.46,.51,.53), .32, .70)
    dark = surface("Dark burner opening", (.031,.036,.037), .68)
    knob = surface("Dark red hand wheel", (.23,.053,.035), .38)
    revolved(asset, "Brass reservoir", [
        (0,0), (.031,0), (.036,.0012), (.039,.0045), (.040,.009), (.039,.024),
        (.035,.032), (.031,.036), (.022,.041), (.014,.043), (0,.043)
    ], brass)
    revolved(asset, "Base rolled lip", [(0,.001),(.036,.001),(.040,.003),
            (.0405,.006),(.039,.008),(0,.008)], bright)
    revolved(asset, "Body shoulder accent", [(0,.025),(.0387,.025),(.0388,.027),
            (.0378,.029),(.0355,.031),(0,.031)], bright)
    revolved(asset, "Primer cup", [(0,.043),(.014,.043),(.019,.046),(.021,.049),
            (.021,.052),(.018,.052),(.016,.048),(.012,.047),(0,.047)], brass_dark, 72)
    rod(asset, "Burner neck", (0,0,.043), (0,0,.077), .0068, brass)
    rod(asset, "Hex union", (0,0,.056), (0,0,.064), .0090, bright, 6)
    rod(asset, "Gas outlet sleeve", (0,0,.071), (0,0,.086), .0074, steel)
    revolved(asset, "Burner outlet ring", [(0,.084),(.0084,.084),(.0086,.086),
            (.0079,.090),(.0033,.090),(.0032,.086),(0,.086)], steel, 56)
    rod(asset, "Burner outlet interior", (0,0,.084), (0,0,.0865), .0034, dark, 32)
    rod(asset, "Fuel cap socket", (.024,.002,.032), (.024,.002,.044), .0063, brass)
    rod(asset, "Fuel cap", (.024,.002,.042), (.024,.002,.047), .0070, bright, 12)
    rod(asset, "Valve spindle", (-.007,0,.061), (-.025,0,.061), .0032, brass_dark, 24)
    rod(asset, "Heat control knob", (-.023,0,.061), (-.029,0,.061), .0066, knob, 20)
    marker(asset, "base", (0,0,0))
    marker(asset, "nozzle", (0,0,.090))
    flame(asset, "TorchFlame", (0,0,.089), .049, .0082,
          ((.10,.31,1),(.51,.85,1)), lean=.87)
    return (0,0,.068), .177, (.55,-1,.38)


def scissor_jack(asset):
    bright = surface("Satin aluminum arms", (.57,.65,.66), .31, .53)
    plate = surface("Brushed aluminum decks", (.49,.56,.56), .41, .45)
    pins = surface("Polished steel pivots", (.69,.73,.73), .32, .60)
    dark = surface("Graphite pads and handle", (.045,.065,.070), .64)
    block(asset, "Bottom plate", (0,0,.007), (.110,.086,.008), plate, .0025)
    block(asset, "Top support plate", (0,0,.0805), (.105,.079,.009), plate, .0028)
    for x in (-.042,.042):
        for y in (-.030,.030):
            block(asset, "Rubber isolation foot", (x,y,.0015), (.017,.015,.003), dark, .0012)
    for row, y in enumerate((-.029,.029)):
        for lower, upper in ((.016,.044),(.044,.072)):
            for parity in (-1,1):
                dx = parity*.033
                arm_y = y + parity*.0038
                a, b = Vector((dx,arm_y,lower)), Vector((-dx,arm_y,upper))
                arm = block(asset, f"Arm {row + 1}", (a+b)/2,
                            ((b-a).length+.006,.0038,.009), bright, .0015)
                arm.rotation_euler.y = -atan2((b-a).z, (b-a).x)
        for x, z in ((-.033,.016),(.033,.016),(0,.030),(-.033,.044),
                     (.033,.044),(0,.058),(-.033,.072),(.033,.072)):
            rod(asset, "Pivot pin", (x,y-.007,z), (x,y+.007,z), .0028, pins, 20)
        for x in (-.033,.033):
            block(asset, "Deck hinge seat", (x,y,.014), (.011,.013,.007), plate, .0013)
            block(asset, "Deck hinge seat", (x,y,.074), (.011,.013,.007), plate, .0013)
    rod(asset, "Transverse pivot shaft", (-.033,-.038,.044), (-.033,.038,.044), .0026, pins, 24)
    rod(asset, "Transverse pivot shaft", (.033,-.038,.044), (.033,.038,.044), .0026, pins, 24)
    rod(asset, "Lead screw", (-.034,0,.044), (.065,0,.044), .0030, pins, 24)
    # The continuous screw thread stays a single mesh for the web viewer.
    thread, faces, turns, sides, resolution = [], [], 26, 6, 11
    rows = turns*resolution + 1
    for i in range(rows):
        phi = tau*i/resolution
        for j in range(sides):
            theta = tau*j/sides
            r = .00307+.00051*sin(theta)
            thread.append((-.019+i*.0021/resolution+.00046*cos(theta), r*cos(phi), .044+r*sin(phi)))
    for i in range(rows-1):
        for j in range(sides):
            k = (j+1) % sides
            faces.append((i*sides+j, i*sides+k, (i+1)*sides+k, (i+1)*sides+j))
    mesh(asset, "Lead screw thread", thread, faces, plate)
    rod(asset, "Crank sleeve", (.047,0,.044), (.062,0,.044), .0043, pins, 18)
    rod(asset, "Adjustment grip", (.061,0,.044), (.071,0,.044), .0062, dark, 20)
    marker(asset, "base", (0,0,0))
    marker(asset, "platform", (0,0,.085))
    return (.006,0,.041), .168, (.60,-1,.51)


def tail_nozzle(asset):
    steel = surface("Brushed stainless steel", (.48,.55,.56), .32, .6)
    dark = surface("Blackened outlet", (.044,.049,.051), .68)
    brass = surface("Transition fitting", (.58,.39,.14), .34, .61)
    rod(asset, "Inlet ferrule", (0,0,0), (.015,0,0), .006, brass, 12)
    rod(asset, "Ferrule shoulder", (.013,0,0), (.021,0,0), .0050, steel, 24)
    # The neck turns downward and tapers at the represented outlet.
    arc = [(.024 + .021*cos(pi/2-pi/2*i/18), -.021 + .021*sin(pi/2-pi/2*i/18), .0038)
           for i in range(19)]
    path_tube(asset, "Bent steel nozzle", [(.016,0,.0038), *arc,
              (.045,-.080,.0038), (.045,-.122,.0036), (.045,-.142,.0018)], steel)
    rod(asset, "Outlet mouth", (.045,0,-.1417), (.045,0,-.145), .00145, dark, 24)
    marker(asset, "inlet", (0,0,0))
    marker(asset, "tip", (.045,0,-.145))
    marker(asset, "pilot-wick", (.045,0,-.189))
    flame(asset, "PilotFlame", (.045,0,-.189), .045, .0062,
          ((1,.26,.021),(1,.71,.11)), lean=1.35)
    flame(asset, "TailFlame", (.045,0,-.145), .030, .0064,
          ((.08,.30,1),(.25,.74,1)), lean=25, down=True)
    return (.026,0,-.088), .265, (.18,-1,.18)


ASSETS = {
    "gas-bag-with-valve": gas_bag,
    "alcohol-blowtorch": blowtorch,
    "lab-scissor-jack": scissor_jack,
    "tail-gas-nozzle": tail_nozzle,
}


def build(asset_id, output, render):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system, scene.unit_settings.scale_length = "METRIC", 1
    asset, studio = collection("ASSET"), collection("PREVIEW ONLY")
    target, diameter, direction = ASSETS[asset_id](asset)
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ Vector(corner) for obj in asset.objects if obj.type == "MESH"
               for corner in obj.bound_box]
    floor_z = min(point.z for point in corners) - diameter*.003
    floor = surface("Studio matte blue-gray", (.16,.21,.25), .72)
    mesh(studio, "Backdrop", [(-4,-4,floor_z),(4,-4,floor_z),(4,4,floor_z),(-4,4,floor_z)],
         [(0,1,2,3)], floor)
    camera = bpy.data.cameras.new("Review camera")
    cam = bpy.data.objects.new("Review camera", camera)
    studio.objects.link(cam)
    cam.location = Vector(target) + Vector(direction).normalized()*diameter*2
    look_at(cam, target)
    camera.type, camera.ortho_scale, camera.clip_start = "ORTHO", diameter, .001
    scene.camera = cam
    scene.world = bpy.data.worlds.new("Neutral room light")
    scene.world.use_nodes = True
    world = scene.world.node_tree.nodes.get("Background")
    world.inputs["Color"].default_value = (.65,.72,.77,1)
    world.inputs["Strength"].default_value = .26
    for name, delta, power, width, height, color in (
        ("Key softbox", (-.6,-.7,1.1), 30, .88, 1.06, (1,.93,.85)),
        ("Front fill", (.58,-1,.26), 12, .71, .92, (.82,.91,1)),
        ("Edge softbox", (.37,.60,.79), 23, .62, .90, (1,.95,.89))
    ):
        softbox(studio, name, target, Vector(target)+Vector(delta)*diameter,
                power*diameter**2, width*diameter, height*diameter, color)

    scene.render.engine = "CYCLES"
    scene.cycles.samples, scene.cycles.use_denoising = 16, True
    scene.render.resolution_x, scene.render.resolution_y = 540, 540
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = "//preview.png"
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                view = area.spaces.active
                view.overlay.show_floor = False
                view.overlay.show_axis_x = view.overlay.show_axis_y = False
                view.region_3d.view_perspective = "ORTHO"
                view.region_3d.view_location = target
                view.region_3d.view_rotation = cam.rotation_euler.to_quaternion()
                view.region_3d.view_distance = diameter*1.65
                view.shading.color_type = "MATERIAL"
                view.clip_start = .001
    for obj in studio.objects:
        obj.hide_set(True)
    bpy.ops.object.select_all(action="DESELECT")
    output.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(output/f"{asset_id}.blend"), compress=True)
    export_asset(output/f"{asset_id}.glb")
    if render:
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    repo = Path(__file__).resolve().parents[2]
    opts = argparse.ArgumentParser(description=__doc__)
    opts.add_argument("--assets", nargs="+", choices=ASSETS, default=list(ASSETS))
    opts.add_argument("--asset-root", type=Path, default=repo/"assets")
    opts.add_argument("--skip-render", action="store_true")
    args = opts.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    for asset_id in args.assets:
        build(asset_id, args.asset_root.resolve()/asset_id/"v1", not args.skip_render)
