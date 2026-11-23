"""Build v2 candidate moving-coil meters and their front/side review views."""

import argparse
import json
from math import cos, pi, radians, sin
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from create_alcohol_lamp import mesh, softbox
from create_co_hardware import bevel, surface
from create_electric_apparatus import Apparatus
from create_stand import collection, look_at
from export_asset import export_asset


METER_IDS = ("analog-ammeter", "analog-voltmeter")
DIAL_TILT = radians(64)
ARC_DEGREES = 112


def case(lab, width, shade):
    """The molded case narrows from its footed base to its raised dial head."""
    section = [(-.050,.006),(-.050,.019),(-.022,.030),(.013,.099),
               (.032,.100),(.047,.079),(.050,.022),(.050,.005)]
    verts = [(x,y,z) for x in (-width/2,width/2) for y,z in section]
    count = len(section)
    side = [(i,i+count,(i+1)%count+count,(i+1)%count) for i in range(count)]
    side.extend((tuple(range(count)), tuple(reversed(range(count,2*count)))))
    return bevel(mesh(lab.group, "One-piece tapered meter shell", verts, side, lab.mats[shade]), .0024)


def foot_slots(lab):
    lab.feet(.044,.039,.017,.015)
    lab.block("Recessed bottom cover", (0,.002,.004), (.106,.088,.004), "dark-shell", .002)
    for x in (-.047,.047):
        for y in (-.036,.036):
            lab.cylinder("Base fastener", x,y,.0016,.0025,.0018,"chrome",12)


def trim(lab, title, dims, border, z, mat, parent):
    width, height, thick = dims
    for x in (-1,1):
        lab.block(title, (x*(width-border)*.5,0,z), (border,height,thick), mat, .0007, parent)
    for y in (-1,1):
        lab.block(title, (0,y*(height-border)*.5,z), (width-2*border,border,thick), mat, .0007, parent)


def scale(lab, panel, is_current):
    center_y, radius = -.027, .0465
    divisions, low_angle = 30, 146
    marks, faces = [], []
    for i in range(divisions+1):
        angle = radians(low_angle - ARC_DEGREES*i/divisions)
        major = i%5 == 0
        inner = radius-(.0049 if major else .0026)
        width = .00036 if major else .00022
        faces.append(tuple(range(len(marks),len(marks)+4)))
        for r,w in ((inner,-width),(radius,-width),(radius,width),(inner,width)):
            marks.append((r*cos(angle)-w*sin(angle),center_y+r*sin(angle)+w*cos(angle),.0048))
        if major:
            rr = radius+.0064
            value = f"{i/50:.1f}" if i and is_current else f"{i/5:g}"
            lab.text(value, (rr*cos(angle),center_y+rr*sin(angle),.0049), .0063, "lettering", panel)
    mesh(lab.group, "Etched scale divisions", marks, faces, lab.mats["lettering"]).parent = panel
    lab.text("A" if is_current else "V", (0,-.0019,.0049), .0158, "lettering", panel)
    lab.block("DC symbol solid stroke", (0,-.0116,.0049), (.008,.00055,.0002), "lettering", 0, panel)
    for x in (-.00265,0,.00265):
        lab.block("DC symbol interrupted stroke", (x,-.013,.0049), (.00145,.00045,.0002), "lettering", 0, panel)

    # This local Z axis subsequently becomes local +Y in the GLB; the hinge moves the physical pointer mesh.
    needle = lab.empty("MeterNeedle", (0,center_y,.0073), panel)
    angle = radians(low_angle)
    direction = Vector((cos(angle),sin(angle),0))
    normal = Vector((-sin(angle),cos(angle),0))
    pts = [(-.0045,-.00082),(.014,-.00068),(.0457,-.00025),(.0465,0),
           (.0457,.00025),(.014,.00068),(-.0045,.00082)]
    pointer = mesh(lab.group, "Tapered physical pointer", [tuple(x*direction+y*normal) for x,y in pts],
                   [tuple(range(len(pts)))], lab.mats["lettering"])
    pointer.parent = needle
    tip = mesh(lab.group, "Vermilion pointer tip", [tuple(x*direction+y*normal+Vector((0,0,.00007)))
               for x,y in ((.035,-.00034),(.0457,-.00025),(.0465,0),(.0457,.00025),(.035,.00034))],
               [(0,1,2,3,4)], lab.mats["red"])
    tip.parent = needle
    lab.cylinder("Pivot metal collar", 0,center_y,.0049,.0067,.0042,"steel-gray",24,panel)
    lab.cylinder("Pivot cap", 0,center_y,.0075,.0085,.0027,"lettering",24,panel)
    return needle


def model(lab, is_current):
    additions = {
        "dark-shell": ((.023,.037,.046),.34,.0),
        "shell-lip": ((.064,.080,.089),.36,.04),
        "label-green": ((.025,.112,.066),.37,.04),
        "paper": ((.92,.925,.885),.65,.0),
        "lettering": ((.013,.018,.024),.5,.0),
        "steel-gray": ((.49,.55,.59),.31,.46),
        "clear-window": ((.75,.86,.95),.17,.0),
    }
    lab.mats.update({name: surface(name,*spec) for name,spec in additions.items()})
    glass = lab.mats["clear-window"]
    glass.node_tree.nodes.get("Principled BSDF").inputs["Alpha"].default_value = .08
    glass.surface_render_method = "BLENDED"
    case(lab,.113,"dark-shell")
    foot_slots(lab)

    # The front apron and green terminal panel project ahead of the inclined meter housing.
    contacts = lab.empty("Terminal apron", (0,-.037,.0248))
    contacts.rotation_euler.x = radians(15)
    lab.block("Molded terminal shelf", (0,0,-.001), (.113,.030,.004), "shell-lip", .0018, contacts)
    lab.block("Green laminate terminal board", (0,0,.00145), (.103,.023,.001), "label-green", .0005, contacts)
    trim(lab,"Cream terminal legend border",(.102,.022,.00025),.0006,.00205,"paper",contacts)
    lab.jack("n", -.035,-.035,.038,"ink")
    lab.jack("p", .035,-.035,.038,"red")
    lab.text("COM",(-.035,-.0065,.00225),.0067,"paper",contacts)
    lab.text("0.6 A" if is_current else "6 V",(.035,-.0065,.00225),.0067,"paper",contacts)
    lab.text("DC",(0,.001,.00225),.0074,"paper",contacts)

    panel = lab.empty("TiltedDial", (0,-.001,.064))
    panel.rotation_euler.x = DIAL_TILT
    lab.block("Meter head sealing rim", (0,0,-.001), (.112,.085,.006), "shell-lip", .0025, panel)
    lab.block("Dial plate backing", (0,0,.0024), (.108,.080,.004), "steel-gray", .0019, panel)
    lab.block("Pale printed scale plate", (0,0,.00425), (.104,.076,.001), "paper", .0011, panel)
    needle = scale(lab, panel, is_current)
    for x in (-.044,.044):
        lab.cylinder("Face screw ferrule", x,-.022,.0047,.0064,.0037,"steel-gray",24,panel)
        lab.block("Slotted screw recess", (x,-.022,.0065), (.0034,.00042,.00018), "lettering", 0, panel)
    for x in (-.050,.050):
        lab.block("Face window spacing rib", (x,0,.0073), (.0023,.076,.006), "steel-gray", .0005,panel)
    trim(lab,"Polished window edge",(.108,.079,.0042),.00225,.0104,"steel-gray",panel)
    # Keep the pane as one thin surface so the web renderer does not sort two overlapping sheets.
    window = mesh(lab.group,"Clear dial window",[(-.052,-.037,.0125),(.052,-.037,.0125),
                  (.052,.037,.0125),(-.052,.037,.0125)],[(0,1,2,3)],glass)
    window.parent = panel

    for x in (-.039,.039):
        lab.cylinder("Back-shell service screw", x,.046,.021,.023,.0022,"steel-gray",12)
    for i in range(5):
        lab.block("Rear case grip recess", (-.014+i*.007,.0479,.050), (.004,.0018,.014), "lettering", .0005)
    return needle


def build(asset_id, asset_root, evidence):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system, scene.unit_settings.scale_length = "METRIC", 1
    asset, studio = collection("ASSET"), collection("PREVIEW ONLY")
    lab = Apparatus(asset)
    needle = model(lab, asset_id == "analog-ammeter")
    output = asset_root/asset_id/"v2"
    output.mkdir(parents=True, exist_ok=True)

    camera = bpy.data.cameras.new("Review camera")
    cam = bpy.data.objects.new("Review camera", camera)
    studio.objects.link(cam)
    camera.type, camera.ortho_scale, camera.clip_start = "ORTHO", .175, .001
    scene.camera = cam
    target = Vector((0,-.004,.052))
    scene.world = bpy.data.worlds.new("Studio environment")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes.get("Background").inputs["Strength"].default_value = .31
    for name, position, power, width, height, tint in (
        ("High key",(-.10,-.18,.23),1.7,.18,.23,(1,.95,.88)),
        ("Soft face fill",(.14,-.18,.10),.75,.12,.18,(.82,.92,1)),
        ("Back rim",(.10,.14,.22),1.65,.11,.17,(.89,.95,1)),
    ):
        softbox(studio, name, target, position,power,width,height,tint)
    scene.render.engine = "CYCLES"
    scene.cycles.samples, scene.cycles.use_denoising = 28, True
    scene.render.threads_mode, scene.render.threads = "FIXED", 6
    scene.render.resolution_x, scene.render.resolution_y = 550, 500
    scene.render.resolution_percentage, scene.render.film_transparent = 100, True
    scene.render.image_settings.file_format, scene.render.image_settings.color_mode = "PNG", "RGBA"

    def aim(direction):
        cam.location = target + Vector(direction).normalized()*.31
        look_at(cam,target)

    aim((.51,-1,.49))
    scene.render.filepath = "//preview.png"
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                view = area.spaces.active
                view.overlay.show_floor = view.overlay.show_extras = False
                view.overlay.show_axis_x = view.overlay.show_axis_y = False
                view.region_3d.view_perspective = "ORTHO"
                view.region_3d.view_location, view.region_3d.view_distance = target,.24
                view.region_3d.view_rotation = cam.rotation_euler.to_quaternion()
                view.shading.color_type, view.clip_start = "MATERIAL",.001
    for obj in studio.objects:
        obj.hide_set(True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(output/f"{asset_id}.blend"), compress=True)
    export_asset(output/f"{asset_id}.glb")
    bpy.ops.render.render(write_still=True)
    if evidence:
        evidence.mkdir(parents=True, exist_ok=True)
        for view, direction, fraction in (("front-zero",(0,-1,.40),0),
                                           ("side",(1,0,.025),0),
                                           ("front-midscale",(0,-1,.40),.5),
                                           ("front-fullscale",(0,-1,.40),1)):
            aim(direction)
            needle.rotation_euler.z = -radians(ARC_DEGREES)*fraction
            scene.render.filepath = str(evidence/f"{asset_id}-{view}.png")
            bpy.ops.render.render(write_still=True)
    print("METER_ANCHORS",asset_id,json.dumps(lab.anchors))


if __name__ == "__main__":
    repo = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets",nargs="+", choices=METER_IDS, default=METER_IDS)
    parser.add_argument("--asset-root",type=Path,default=repo/"assets")
    parser.add_argument("--evidence", type=Path)
    opts = parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    for asset_id in opts.assets:
        build(asset_id,opts.asset_root.resolve(),opts.evidence.resolve() if opts.evidence else None)
