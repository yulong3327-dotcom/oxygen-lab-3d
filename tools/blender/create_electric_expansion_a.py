"""Rebuild school electricity components using original meshes and named contacts."""

import argparse
import json
from math import cos, pi, sin, tau
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import create_electric_apparatus as factory
from create_alcohol_lamp import mesh, revolved
from create_co_hardware import surface


def paint(lab, name, color, roughness=.38, metallic=0, alpha=1, emission=0):
    material = surface(name,color,roughness,metallic)
    shader = material.node_tree.nodes.get("Principled BSDF")
    if alpha != 1:
        shader.inputs["Alpha"].default_value = alpha
        material.surface_render_method = "BLENDED"
    if emission:
        shader.inputs["Emission Color"].default_value = (*color,1)
        shader.inputs["Emission Strength"].default_value = emission
    lab.mats[name] = material
    return material


def tray(lab, title, width, depth, post_x, post_y, voltage_label=None):
    lab.feet(width*.36,depth*.31, .016,.012)
    lab.block(title,(0,0,.0095),(width,depth,.016),"blue",.0033)
    lab.block("Top shoulder",(0,0,.016),(width-.005,depth-.005,.004),"blue-light",.0016)
    lab.jack("p",-post_x,post_y,.029,"red")
    lab.jack("n",post_x,post_y,.029,"ink")
    if voltage_label:
        lab.text(voltage_label,(0,post_y-.002,.0183),.007,"ivory")


def battery(lab, total):
    width = .114 if total == 1 else .176
    tray(lab,"Molded battery cradle",width,.061,width/2-.0115,-.012, f"{1.5*total:g} V")
    paint(lab,"cell-sleeve",(.91,.53,.095),.31,.09)
    paint(lab,"cell-print",(.53,.037,.026),.62)
    y,z = .009,.033
    body_start = -.031 if total == 1 else -.062
    for i in range(total):
        left = body_start+i*.062
        right = left+.059
        lab.rod("Dry cell sleeve",(left,y,z),(right,y,z),.0135,"cell-sleeve",36)
        for x in (left,right):
            lab.rod("Cell end cap",(x-.0013,y,z),(x+.0013,y,z),.0125,"chrome",32)
        lab.rod("Cell positive button",(left-.0036,y,z),(left-.001,y,z),.0051,"chrome",24)
        lab.text("+",(left+.012,y,z+.01365),.0105,"cell-print")
        lab.text("1.5 V",(left+.034,y,z+.01365),.0078,"cell-print")
        lab.text("−",(right-.008,y,z+.01365),.008,"cell-print")
    for x in (body_start-.006,-body_start+.004):
        lab.block("Upright cell holder",(x,y,.025),(.006,.032,.019),"blue-light",.0023)
    lab.text("+",(-width/2+.010,-.025,.0185),.008,"ivory")
    lab.text("−",(width/2-.010,-.025,.0185),.008,"ivory")


def spdt(lab):
    lab.feet(.061,.026)
    lab.block("Molded three-contact switch base",(0,0,.010),(.166,.072,.017),"blue",.0034)
    lab.block("Upper switch shoulder",(0,0,.018),(.161,.067,.004),"blue-light",.0018)
    for name,x,ink,label in (("n",-.059,"red","1"),("p",0,"red","C"),("b",.059,"ink","2")):
        lab.jack(name,x,-.018,.032,ink)
        lab.text(label,(x,-.029,.0205),.0075,"ivory")
        lab.block("Terminal bus plate",(x,.006,.022),(.020,.029,.003),"brass",.0008)
        for y in (.002,.016):
            lab.block("Exposed contact forks",(x,y,.033),(.013,.006,.022),"brass",.001)
    lab.rod("Center hinge round pin",(0,-.003,.040),(0,.022,.040),.0034,"chrome",20)
    lever = lab.empty("SwitchLever",(0,.009,.040))
    lab.block("Selector knife blade",(0,0,.031),(.007,.005,.067),"chrome",.0012,lever)
    lab.block("Blue insulating handle",(0,0,.071),(.015,.016,.024),"blue-dark",.0038,lever)
    lab.block("Molded handle stop",(0,0,.063),(.017,.018,.007),"blue-light",.0019,lever)
    lever.rotation_euler.y = -pi/2
    lab.anchor("lever",0,.009,.040)


def bulb(lab):
    tray(lab,"Blue lamp-holder base",.120,.080,.045,-.014)
    lab.cylinder("Molded E10 holder",0,.009,.017,.051,.0225,"blue-light",44)
    lab.cylinder("Insulator top",0,.009,.048,.054,.0145,"ink",40)
    lab.cylinder("Bulb screw collar",0,.009,.052,.064,.0112,"chrome",40)
    for i in range(3):
        lab.cylinder("Screw sleeve ring",0,.009,.054+i*.003,.0553+i*.003,.01165,"gray",32)
    clear = paint(lab,"bulb glass",(.80,.90,1),.13,.0,.24)
    profile = [(0,.061),(.010,.061),(.011,.067),(.015,.073),(.020,.080),(.023,.090),(.022,.099),
               (.017,.107),(.010,.112),(0,.114)]
    globe = revolved(lab.group,"Clear glass bulb envelope",profile,clear,sides=40)
    globe.location.y = .009
    for x in (-.005,.005):
        lab.rod("Filament lead",(x,.009,.059),(x,.009,.092),.0008,"gray",12)
    lab.rod("Tungsten span",(-.005,.009,.092),(.005,.009,.092),.00065,"ink",12)
    glow = lab.empty("LampGlow",(0,.009,.092))
    paint(lab,"Hot tungsten",(1,.43,.055),.31,0,1,4)
    lab.rod("Glowing filament",(-.005,.0002,0),(.005,.0002,0),.00115,"Hot tungsten",14,glow).hide_render = True
    warm = paint(lab,"Warm energized glass",(1,.50,.115),.21,0,.29,1.7)
    lit = revolved(lab.group,"Lit glass surface",[(r*.995,z-.092) for r,z in profile],warm,sides=36)
    lit.parent = glow
    lit.hide_render = True


def led(lab):
    tray(lab,"LED terminal carrier",.084,.053,.031,-.009)
    for x,z in ((-.0045,.052),(.0045,.041)):
        lab.rod("LED pin",(x,.006,.019),(x,.006,z),.0011,"chrome",12)
    for x in (-1,1):
        lab.rod("Terminal to diode lead",(x*.028,-.007,.0195),(x*.0045,.006,.0195),.0011,"chrome",12)
    lens = paint(lab,"Red epoxy LED",(.58,.019,.011),.22,0,.75)
    prof = [(0,.038),(.009,.038),(.009,.041),(.008,.042),(.008,.054),(.0073,.0577),(.0055,.0604),(.0029,.0622),(0,.0628)]
    head = revolved(lab.group,"Red 5 mm style LED package",prof,lens,sides=36)
    head.location.y = .006
    glow = lab.empty("LampGlow",(0,.006,0))
    luminous = paint(lab,"Lit red diode",(1,.018,.007),.3,0,.75,3)
    lit = revolved(lab.group,"Powered diode cap",[(r*1.003,z) for r,z in prof],luminous,sides=36)
    lit.parent = glow
    lit.hide_render = True
    lab.text("+",(-.028,-.020,.0184),.0075,"ivory")
    lab.text("−",(.028,-.020,.0184),.0075,"ivory")


def solenoid(lab):
    tray(lab,"Insulated solenoid stand",.105,.075,.039,-.017)
    x0,y0,z0 = 0,.008,.026
    for z in (z0,.088):
        lab.cylinder("Black coil flange",x0,y0,z-.003,z+.003,.024,"ink",42)
    lab.cylinder("Enameled coil bobbin",x0,y0,z0,.088,.016,"blue-dark",38)
    turns, detail, sides = 42,14,7
    verts, faces = [], []
    for i in range(turns*detail+1):
        phi = tau*i/detail
        for j in range(sides):
            cross = tau*j/sides
            radius = .0169+.00068*cos(cross)
            verts.append((radius*cos(phi),y0+radius*sin(phi),.030+.054*i/(turns*detail)+.00068*sin(cross)))
    for i in range(turns*detail):
        for j in range(sides):
            k = (j+1)%sides
            faces.append((i*sides+j,i*sides+k,(i+1)*sides+k,(i+1)*sides+j))
    winding = mesh(lab.group,"Continuous copper winding",verts,faces,lab.mats["coil"])
    for face in winding.data.polygons:
        face.use_smooth = True
    lab.cylinder("Core opening",x0,y0,.0878,.0915,.009,"ink",30)
    lab.rod("Positive coil flying lead",(-.036,-.016,.022),(-.019,-.004,.084),.00105,"coil",12)
    lab.rod("Return coil lead",(.036,-.016,.021),(.017,.001,.031),.00105,"coil",12)
    lab.text("+",(-.039,-.03,.0184),.0074,"ivory")
    lab.text("−",(.039,-.03,.0184),.0074,"ivory")


def bell(lab):
    tray(lab,"School bell base",.116,.088,.043,-.019)
    lab.block("Bell mounting upright",(0,.021,.047),(.023,.014,.066),"blue-dark",.003)
    bow = revolved(lab.group,"Pressed steel bell gong",[(0,0),(.010,-.002),(.021,-.006),
                   (.032,-.014),(.036,-.018),(.036,-.020),(.032,-.020),(.029,-.016),
                   (.020,-.009),(.011,-.005),(0,-.003)],lab.mats["chrome"],sides=56)
    bow.rotation_euler.x = pi/2
    bow.location = (0,.012,.075)
    lab.rod("Gong bolt",(0,.014,.075),(0,.009,.075),.0045,"gray",12)
    for x in (-.018,.018):
        lab.rod("Electromagnet coil",(x,-.004,.033),(x,.020,.033),.009,"coil",36)
        lab.rod("Electromagnet core",(x,-.008,.033),(x,.023,.033),.005,"gray",24)
    arm = lab.empty("BellHammer",(0,-.021,.038))
    lab.rod("Hammer rod",(0,0,0),(0,-.002,.028),.0019,"chrome",16,arm)
    lab.rod("Striker head",(-.004,-.002,.030),(.004,-.002,.030),.004,"brass",16,arm)
    lab.block("Spring element",(0,-.018,.040),(.020,.004,.006),"chrome",.00075)


def buzzer(lab):
    tray(lab,"Two-pin buzzer cradle",.075,.055,.027,-.012)
    lab.cylinder("Piezo buzzer bottom",0,.006,.022,.031,.017,"blue-dark",40)
    lab.cylinder("Piezo buzzer ribbed body",0,.006,.030,.043,.0175,"gray",48)
    lab.cylinder("Sound port top flange",0,.006,.043,.046,.0174,"ivory",48)
    lab.cylinder("Black sound port recess",0,.006,.046,.0465,.0042,"ink",32)
    for x in (-.010,.010):
        lab.rod("Piezo pin",(x,.006,.019),(x,.006,.023),.0016,"chrome",16)
    lab.text("+",(-.028,-.024,.0184),.0074,"ivory")


def motor(lab):
    tray(lab,"Motor demonstration base",.119,.084,.044,-.018)
    lab.block("Motor height bracket",(0,.011,.043),(.026,.035,.051),"blue-light",.004)
    lab.rod("DC motor can",(0,.031,.071),(0,-.006,.071),.018,"gray",44)
    lab.rod("Motor back cap",(0,.035,.071),(0,.031,.071),.0183,"red",40)
    lab.rod("Motor shaft",(0,-.011,.071),(0,-.020,.071),.0026,"chrome",16)
    ring = revolved(lab.group,"Fan back guard rim",[(.034,-.001),(.036,-.001),(.037,.002),(.0365,.004),
                     (.034,.004),(.0335,.002),(.034,-.001)],lab.mats["blue-light"],sides=56)
    ring.rotation_euler.x = pi/2
    ring.location = (0,.005,.071)
    for i in range(5):
        a=tau*i/5
        lab.rod("Guard radial support",(.015*cos(a),.005,.071+.015*sin(a)),
                (.034*cos(a),.005,.071+.034*sin(a)),.0014,"blue-dark",12)
    rotor=lab.empty("MotorRotor",(0,-.021,.071))
    lab.rod("Propeller hub",(0,-.004,0),(0,.004,0),.0085,"blue-light",32,rotor)
    paint(lab,"Fan blades",(.52,.73,.83),.34,.025)
    contour=((.006,-.004),(.017,-.003),(.030,.001),(.038,.009),(.040,.016),
             (.036,.021),(.029,.020),(.020,.014),(.012,.007),(.006,.005))
    for i in range(3):
        a=tau*i/3; c,s=cos(a),sin(a)
        vertices=[(c*x-s*z,y-.07*z,s*x+c*z) for y in (-.0012,.0012) for x,z in contour]
        count=len(contour)
        faces=[tuple(reversed(range(count))),tuple(range(count,2*count))]
        faces.extend((j,(j+1)%count,(j+1)%count+count,j+count) for j in range(count))
        blade=mesh(lab.group,"Swept fan blade",vertices,faces,lab.mats["Fan blades"])
        blade.parent=rotor


GROUP = {
    "battery-single": ("单节电池座", lambda lab: battery(lab,1), (0,0,.024),.141,(.29,-1,1.2)),
    "battery-pack": ("双节电池组", lambda lab: battery(lab,2), (0,0,.024),.213,(.27,-1,1.1)),
    "switch-spdt": ("单刀双掷开关",spdt,(0,0,.032),.205,(.26,-1,.91)),
    "lamp-bulb": ("小灯泡",bulb,(0,0,.052),.188,(.23,-1,.74)),
    "led": ("发光二极管",led,(0,0,.026),.104,(.28,-1,.81)),
    "solenoid": ("通电螺线管",solenoid,(0,0,.043),.164,(.27,-1,.72)),
    "bell": ("电铃",bell,(0,0,.053),.183,(.36,-1,.68)),
    "buzzer": ("两脚蜂鸣器",buzzer,(0,0,.024),.108,(.34,-1,.94)),
    "motor-fan": ("电动机（风扇）",motor,(0,0,.056),.181,(.30,-1,.64)),
}


def metadata(asset_id, root):
    prefix=f"assets/{asset_id}/v1"
    model=root/asset_id/"v1"/(asset_id+".glb")
    with model.open("rb") as glb:
        header = glb.read(20)
        data = json.loads(glb.read(struct.unpack_from("<I",header,12)[0]))
    ports={"base","p","n","b","lever"}
    anchors = {n["name"]: [round(v,6) for v in n.get("translation",[0,0,0])]
               for n in data["nodes"] if n["name"] in ports}
    assert {"base","p","n"} <= anchors.keys()
    return dict(id=asset_id,title=GROUP[asset_id][0],version=1,status="candidate",source=f"{prefix}/{asset_id}.blend",
                model=f"{prefix}/{asset_id}.glb",preview=f"{prefix}/preview.png",anchors=anchors,
                provenance="依据旧版电学器材库的外形和端子用途原创重绘 Blender 模型，未嵌入参考图。")


if __name__ == "__main__":
    repo = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets",nargs="+",choices=GROUP,default=list(GROUP))
    parser.add_argument("--asset-root",type=Path,default=repo/"assets")
    parser.add_argument("--metadata",type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    for key in args.assets:
        factory.ASSETS[key] = GROUP[key][1:]
        factory.build(key,args.asset_root.resolve()/key/"v1",True)
    if args.metadata:
        args.metadata.parent.mkdir(parents=True,exist_ok=True)
        args.metadata.write_text(json.dumps([metadata(key,args.asset_root) for key in args.assets],ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
