"""Build the six reusable school electricity instruments, without image textures."""

import argparse
import json
from math import cos, pi, radians, sin, tau
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from create_alcohol_lamp import mesh, softbox
from create_co_hardware import block, rod, surface
from create_stand import collection, look_at
from export_asset import export_asset


class Apparatus:
    def __init__(self, group):
        self.group = group
        self.anchors = {"base": [0, 0, 0]}
        swatches = {
            "blue": ((.065, .225, .42), .29, .02),
            "blue-dark": ((.028, .079, .14), .37, .06),
            "blue-light": ((.16, .39, .62), .32, .02),
            "green": ((.044, .25, .19), .36, .02),
            "ivory": ((.89, .86, .78), .44, .01),
            "dial": ((.93, .94, .91), .62, .0),
            "red": ((.55, .026, .018), .32, .01),
            "ink": ((.016, .025, .038), .53, .0),
            "gray": ((.31, .37, .42), .43, .16),
            "chrome": ((.59, .63, .66), .29, .68),
            "brass": ((.66, .40, .144), .29, .63),
            "coil": ((.51, .183, .052), .42, .53),
            "ceramic": ((.71, .69, .58), .51, .0),
        }
        self.mats = {name: surface(name, *spec) for name, spec in swatches.items()}
        self.empty("base", (0, 0, 0))

    def empty(self, name, position, parent=None):
        obj = bpy.data.objects.new(name, None)
        self.group.objects.link(obj)
        obj.empty_display_type, obj.empty_display_size = "PLAIN_AXES", .008
        obj.parent, obj.location = parent, position
        return obj

    def anchor(self, name, x, y, z):
        self.empty(name, (x, y, z))
        self.anchors[name] = [x, z, -y]

    def block(self, name, center, dims, mat, bevel=.001, parent=None):
        obj = block(self.group, name, center, dims, self.mats[mat], bevel)
        obj.parent = parent
        return obj

    def rod(self, name, start, end, radius, mat, sides=24, parent=None):
        obj = rod(self.group, name, start, end, radius, self.mats[mat], sides)
        obj.parent = parent
        return obj

    def cylinder(self, name, x, y, bottom, top, radius, mat, sides=24, parent=None):
        return self.rod(name, (x,y,bottom), (x,y,top), radius, mat, sides, parent)

    def text(self, value, pos, size, mat, parent=None, front=False):
        curve = bpy.data.curves.new(f"Marking {value}", "FONT")
        curve.body, curve.align_x, curve.align_y = value, "CENTER", "CENTER"
        curve.size, curve.resolution_u = size, 6
        obj = bpy.data.objects.new(f"Marking {value}", curve)
        self.group.objects.link(obj)
        obj.parent, obj.location = parent, pos
        if front:
            obj.rotation_euler.x = pi / 2
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.convert(target="MESH")
        obj.data.materials.append(self.mats[mat])
        return obj

    def jack(self, name, x, y, z, color):
        self.cylinder(f"{name} socket washer", x, y, z-.012, z-.009, .0085, "ink")
        self.cylinder(f"{name} socket foot", x, y, z-.010, z-.007, .0072, color)
        # A stepped annulus and recessed metal contact give the socket a real opening.
        profile = [(.0064,-.008),(.0064,-.0014),(.0057,0),(.00335,0),
                   (.00255,-.001),(.00255,-.006),(.0018,-.006)]
        sections = 48
        verts = []
        for row, (r,h) in enumerate(profile):
            for i in range(sections):
                theta = tau*i/sections
                radius = r + (.00042 if row < 2 and i % 4 in (0,1) else 0)
                verts.append((x + radius*cos(theta), y + radius*sin(theta), z+h))
        faces = [(j*sections+i, j*sections+(i+1)%sections,
                  (j+1)*sections+(i+1)%sections, (j+1)*sections+i)
                 for j in range(len(profile)-1) for i in range(sections)]
        socket = mesh(self.group, f"{name} binding socket", verts, faces, self.mats[color])
        socket.data.materials.append(self.mats["chrome"])
        for face in socket.data.polygons:
            if face.index >= 3*sections:
                face.material_index = 1
        self.cylinder(f"{name} recess", x, y, z-.008, z-.006, .0027, "ink")
        self.anchor(name, x, y, z)

    def feet(self, x, y, width=.019, depth=.012):
        for xx in (-x,x):
            for yy in (-y,y):
                self.block("Rubber foot", (xx,yy,.002), (width,depth,.004), "ink", .0013)


def power(lab):
    lab.feet(.052, .034)
    lab.block("Insulated power enclosure", (0,0,.023), (.140,.090,.039), "blue", .005)
    lab.block("Molded lid", (0,0,.039), (.140,.090,.011), "blue-light", .003)
    lab.block("Brushed ivory faceplate", (0,-.045,.026), (.125,.0018,.024), "ivory", .0008)
    lab.text("DC 6 V", (0,-.046,.027), .015, "blue-dark", front=True)
    lab.jack("p", .052, -.021, .056, "red")
    lab.jack("n", -.052, -.021, .056, "ink")
    lab.text("+", (.035,-.021,.0448), .012, "red")
    lab.text("−", (-.035,-.021,.0448), .012, "ink")
    lab.text("6 V  DC", (0,.015,.0448), .011, "ivory")
    for x in (-.052,.052):
        lab.cylinder("Recessed lid screw", x, .031, .0442, .045, .0024, "chrome")


def knife(lab):
    lab.feet(.061,.028)
    lab.block("Switch base", (0,0,.010), (.162,.074,.017), "blue", .004)
    lab.block("Base upper shoulder", (0,0,.018), (.157,.069,.004), "blue-light", .0018)
    lab.jack("p", -.066, -.017, .032, "red")
    lab.jack("n", .066, -.017, .032, "red")
    lab.text("S", (0,-.023,.0202), .012, "ivory")
    for x in (-.051,.047):
        lab.block("Bus plate", (x,.003,.0215), (.026,.036,.003), "brass", .001)
        for y in (.002,.016):
            lab.block("Spring contact fork", (x,y,.032), (.013,.006,.022), "brass", .001)
    lab.rod("Hinge pin", (-.051,-.002,.039), (-.051,.020,.039), .0031, "chrome", 20)
    lever = lab.empty("SwitchLever", (-.051,.009,.039))
    lab.block("Knife copper blade", (.048,0,0), (.105,.005,.007), "chrome", .0017, lever)
    lab.block("Knife insulated handle", (.108,0,0), (.034,.017,.016), "blue-dark", .004, lever)
    lab.block("Handle molding ring", (.096,0,0), (.008,.019,.017), "blue-light", .002, lever)
    lever.rotation_euler.y = -radians(37)
    lab.anchor("lever", .039, .009, .100)


def meter(lab, is_current):
    lab.feet(.054,.049)
    lab.block("Meter molded base", (0,0,.010), (.140,.136,.017), "blue-dark", .004)
    lab.block("Meter main shell", (0,0,.021), (.137,.128,.014), "blue", .0028)
    lab.block("Contact panel", (0,-.046,.028), (.122,.031,.0025), "green", .0015)
    lab.jack("n", -.042, -.046, .041, "ink")
    lab.jack("p", .042, -.046, .041, "red")
    lab.text("COM", (-.042,-.059,.0294), .0065, "dial")
    lab.text("0.6 A" if is_current else "6 V", (.042,-.059,.0294), .0066, "dial")
    lab.text("DC", (0,-.044,.0294), .0105, "dial")
    lab.block("Rear support", (0,.049,.032), (.105,.022,.047), "blue", .002)
    panel = lab.empty("TiltedDial", (0,.012,.048))
    panel.rotation_euler.x = radians(29)
    lab.block("Dial meter housing", (0,0,-.006), (.137,.092,.014), "blue-light", .004, panel)
    lab.block("Dial meter bezel", (0,0,.002), (.132,.087,.007), "ink", .0028, panel)
    lab.block("Matte dial face", (0,0,.0059), (.125,.081,.002), "dial", .001, panel)
    low, span, ticks = 146, 112, 30
    center_y, radius = -.0325, .0615
    marks, quads = [], []
    for i in range(ticks+1):
        theta = radians(low - span*i/ticks)
        major = i % 5 == 0
        outer = radius
        inner = outer - (.0059 if major else .00315)
        width = .00046 if major else .00027
        quads.append(tuple(range(len(marks),len(marks)+4)))
        for r,w in ((inner,-width),(outer,-width),(outer,width),(inner,width)):
            marks.append((r*cos(theta)-w*sin(theta),center_y+r*sin(theta)+w*cos(theta),.0071))
        if major:
            label = (f"{i/50:.1f}" if i else "0") if is_current else f"{i/5:g}"
            rr = radius + .0072
            lab.text(label, (rr*cos(theta),center_y+rr*sin(theta),.00725), .0065, "ink", panel)
    mesh(lab.group, "Scale divisions", marks, quads, lab.mats["ink"]).parent = panel
    lab.text("A" if is_current else "V", (0,-.004,.00725), .016, "ink", panel)
    lab.block("DC solid line", (0,-.016,.0072), (.009,.0006,.0004), "ink", 0, panel)
    for x in (-.003,0,.003):
        lab.block("DC dashed line", (x,-.0175,.0072), (.00165,.0006,.0004), "ink", 0, panel)
    needle = lab.empty("MeterNeedle", (0,center_y,.0082), panel)
    theta = radians(low)
    direction, normal = Vector((cos(theta),sin(theta),0)), Vector((-sin(theta),cos(theta),0))
    point_verts = [tuple(-.005*direction-.001*normal), tuple(.060*direction),
                   tuple(-.005*direction+.001*normal)]
    point = mesh(lab.group, "Pointer", point_verts, [(0,1,2)], lab.mats["red"])
    point.parent = needle
    lab.cylinder("Pointer spindle", 0, center_y, .0074, .009, .0034, "ink", parent=panel)
    for x in (-.053,.053):
        lab.cylinder("Flange fastener", x, -.030, .0068, .0077, .0025, "chrome", parent=panel)


def resistance(lab):
    lab.feet(.049,.019)
    lab.block("Resistor insulated plinth", (0,0,.010), (.138,.055,.016), "blue", .0036)
    lab.block("Insulated carrier inset", (0,0,.018), (.124,.043,.003), "blue-light", .0014)
    lab.jack("p", -.050, 0, .031, "chrome")
    lab.jack("n", .050, 0, .031, "chrome")
    lab.rod("Resistor lead", (-.045,0,.021), (.045,0,.021), .0015, "chrome", 20)
    lab.rod("Ceramic resistance body", (-.024,0,.022), (.024,0,.022), .0083, "ceramic", 8)
    for x in (-.025,.025):
        lab.rod("Metal end cap", (x-.003,0,.022), (x+.003,0,.022), .0078, "chrome", 24)
    lab.block("Rating patch", (0,-.002,.030), (.039,.012,.001), "ivory", .00045)
    lab.text("10 Ω", (0,-.002,.0306), .0083, "ink")


def rheostat(lab):
    lab.feet(.089,.034,.022,.012)
    lab.block("Rheostat grooved platform", (0,0,.008), (.211,.089,.011), "blue-dark", .0032)
    lab.block("Rheostat platform shoulder", (0,0,.015), (.204,.085,.009), "blue", .0023)
    for name, x, y, color in (("p",-.089,-.029,"red"),("n",-.089,.029,"ink"),
                              ("coil-other",.089,-.029,"red"),("slider-other",.089,.029,"ink")):
        lab.jack(name, x,y,.031,color)
    for value, x, y in (("A",-.075,-.032),("B",.075,-.032),("C",-.092,.016),("D",.092,.016)):
        lab.text(value, (x,y,.0196), .009, "dial")
    lab.text("0–50 Ω", (0,-.032,.0196), .009, "dial")
    for x in (-.076,.076):
        lab.block("Upright coil cradle", (x,0,.034), (.010,.045,.037), "blue-light", .0021)
        lab.block("Rail support tab", (x,.006,.068), (.010,.021,.035), "blue-light", .0021)
        lab.rod("Ceramic winding insulator", (x-.006,0,.047), (x+.006,0,.047), .019, "ceramic", 36)
        lab.rod("Slotted rail retainer", (x-.010,.007,.082), (x+.010,.007,.082), .0047, "chrome", 12)
    lab.rod("Ceramic coil core", (-.073,0,.047), (.073,0,.047), .0158, "ceramic", 42)
    lab.rod("Polished slider rail", (-.090,.007,.082), (.090,.007,.082), .0032, "chrome", 32)
    # One mesh for the winding keeps the amount of work in the browser predictable.
    turns, resolution, sides = 55, 16, 8
    verts, faces = [], []
    rows = turns*resolution + 1
    for i in range(rows):
        theta = tau*i/resolution
        x = -.070 + .140*i/(rows-1)
        for side in range(sides):
            angle = tau*side/sides
            r = .016 + .00114*cos(angle)
            verts.append((x+.00114*sin(angle),r*cos(theta),.047+r*sin(theta)))
    for i in range(rows-1):
        for j in range(sides):
            k = (j+1)%sides
            faces.append((i*sides+j,(i+1)*sides+j,(i+1)*sides+k,i*sides+k))
    winding = mesh(lab.group, "Spiral resistance winding", verts, faces, lab.mats["coil"])
    for face in winding.data.polygons:
        face.use_smooth = True
    # A fixed connection to the coil and a shared connection to the wiper rail at each end.
    for x in (-.076,.076):
        lab.rod("Winding link", (x,-.026,.024),(x,-.009,.039),.0014,"brass")
        lab.rod("Wiper return link", (x,.026,.024),(x,.011,.078),.00125,"chrome")
    slider = lab.empty("RheostatSlider", (.062,.007,.082))
    lab.rod("Slider sleeve", (-.012,0,0),(.012,0,0),.0051,"chrome", 24, slider)
    lab.block("Slider carrier", (0,-.003,.002), (.019,.018,.008), "blue-dark", .0018, slider)
    lab.block("Molded slider handle", (0,-.009,.0085), (.024,.025,.008), "blue-light", .0029, slider)
    lab.block("Contact spring", (0,-.012,-.012), (.007,.0025,.026), "brass", .0008, slider).rotation_euler.x = -.21
    lab.anchor("slider-min", -.062, .007, .0905)
    lab.anchor("slider-max", .062, .007, .0905)


ASSETS = {
    "dc-power-supply": (power, (0,0,.027), .166, (.34,-1,.82)),
    "knife-switch": (knife, (0,0,.038), .187, (.29,-1,.86)),
    "analog-ammeter": (lambda lab: meter(lab, True), (0,-.006,.038), .202, (.26,-1,1.36)),
    "fixed-resistor": (resistance, (0,0,.015), .159, (.34,-1,1.0)),
    "analog-voltmeter": (lambda lab: meter(lab, False), (0,-.006,.038), .202, (.26,-1,1.36)),
    "sliding-rheostat": (rheostat, (0,0,.044), .232, (.12,-1,1.43)),
}


def build(asset_id, output, render):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system, scene.unit_settings.scale_length = "METRIC", 1
    asset, studio = collection("ASSET"), collection("PREVIEW ONLY")
    lab = Apparatus(asset)
    model, target, diameter, direction = ASSETS[asset_id]
    model(lab)
    camera = bpy.data.cameras.new("Review camera")
    cam = bpy.data.objects.new("Review camera", camera)
    studio.objects.link(cam)
    cam.location = Vector(target) + Vector(direction).normalized()*diameter*2
    look_at(cam, target)
    camera.type, camera.ortho_scale, camera.clip_start = "ORTHO", diameter, .001
    scene.camera = cam
    scene.world = bpy.data.worlds.new("Studio environment")
    scene.world.use_nodes = True
    world = scene.world.node_tree.nodes.get("Background")
    world.inputs["Color"].default_value = (.72,.79,.86,1)
    world.inputs["Strength"].default_value = .26
    for name, delta, power, width, height, color in (
        ("Key softbox", (-.52,-.67,1.10), 30, .88, 1.06, (1,.94,.86)),
        ("Side fill", (.70,-.47,.47), 13, .71, .92, (.82,.92,1)),
        ("Edge softbox", (.44,.62,.87), 24, .62, .90, (1,.96,.91)),
    ):
        softbox(studio, name, target, Vector(target)+Vector(delta)*diameter,
                power*diameter**2, width*diameter, height*diameter, color)
    scene.render.engine = "CYCLES"
    scene.cycles.samples, scene.cycles.use_denoising = 24, True
    scene.render.threads_mode, scene.render.threads = "FIXED", 6
    scene.render.resolution_x, scene.render.resolution_y = 500, 420
    scene.render.resolution_percentage, scene.render.film_transparent = 100, True
    scene.render.image_settings.file_format, scene.render.image_settings.color_mode = "PNG", "RGBA"
    scene.render.filepath = "//preview.png"
    scene.view_settings.view_transform = "AgX"
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                view = area.spaces.active
                view.overlay.show_floor = False
                view.overlay.show_extras = False
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
    print("ASSET_ANCHORS", asset_id, json.dumps(lab.anchors, ensure_ascii=False))


if __name__ == "__main__":
    repo = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", nargs="+", choices=ASSETS, default=list(ASSETS))
    parser.add_argument("--asset-root", type=Path, default=repo/"assets")
    parser.add_argument("--skip-render", action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    for asset_id in args.assets:
        build(asset_id, args.asset_root.resolve()/asset_id/"v1", not args.skip_render)
