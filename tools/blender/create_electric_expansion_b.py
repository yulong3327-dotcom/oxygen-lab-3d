"""Build the remaining resistance, heating, motor and meter apparatus."""

import argparse
import json
import struct
from math import cos, pi, radians, sin, tau
from pathlib import Path
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import create_electric_apparatus as factory
import create_electric_expansion_a as common
from create_alcohol_lamp import mesh, revolved
from create_school_meter import case, trim


def board(lab, title, width, depth):
    lab.feet(width*.38,depth*.34)
    lab.block(title,(0,0,.010),(width,depth,.017),"blue",.0039)
    lab.block("Fitted faceplate",(0,0,.018),(width-.006,depth-.006,.0035),"blue-light",.0018)


def resistance_wire(lab):
    board(lab,"Resistance wire experiment board",.193,.080)
    for name,x in (("p",-.080),("n",.080)):
        lab.jack(name,x,-.016,.031,"chrome")
        lab.block("Conductive end clamp",(x,.017,.026),(.012,.019,.013),"brass",.0015)
        lab.rod("Clamp link",(x,-.016,.023),(x,.017,.023),.0015,"chrome",12)
    lab.rod("Taut resistance wire",(-.079,.017,.030),(.079,.017,.030),.0009,"coil",16)
    lab.block("Ivory ruled length plate",(0,-.012,.020),(.139,.027,.0012),"ivory",.00045)
    for i in range(13):
        major = i%3==0
        x = -.062+i*.124/12
        lab.block("Length graduation",(x,-.008,.0208),(.00065,.005 if major else .003,.00023),"ink",0)
        if major:
            lab.text(str(i*5),(x,-.016,.0208),.0057,"ink")
    lab.text("cm",(.070,-.014,.0204),.0052,"ivory")


def resistance_box(lab):
    lab.feet(.046,.039)
    lab.block("Insulated resistance box shell",(0,0,.022),(.122,.103,.041),"blue-dark",.004)
    lab.block("Recessed decade panel",(0,0,.043),(.113,.093,.0045),"green",.0018)
    for j in range(2):
        for i in range(2):
            x,y = (-.028 if not i else .028),(.023 if not j else -.006)
            knob = lab.empty(f"ResistanceDial{j*2+i+1}",(x,y,.048))
            lab.cylinder("Knob fixed skirt",x,y,.044,.049,.013,"ink",24)
            lab.cylinder("Molded selector cap",0,0,0,.008,.0095,"blue-light",24,knob)
            lab.block("Selector indicator stripe",(0,.0035,.0082),(.0016,.0065,.00045),"ivory",.0002,knob)
            lab.text(str(10**(3-(j*2+i)))+" Ω",(x,y-.016,.0455),.0054,"ivory")
    for name,x,mat in (("p",-.037,"red"),("n",.037,"ink")):
        lab.jack(name,x,-.036,.056,mat)
    lab.text("Ω",(0,-.036,.0455),.013,"ivory")


def pencil(lab):
    board(lab,"Graphite rheostat platform",.180,.077)
    for name,x,y,color,label in (("p",-.074,-.023,"red","A"),("b",.074,-.023,"red","B"),
                                  ("c",-.074,.024,"ink","C"),("n",.074,.024,"ink","D")):
        lab.jack(name,x,y,.031,color)
        lab.text(label,(x*.80,y,.0202),.009,"ivory")
    for x in (-.066,.066):
        lab.block("Pencil supports",(x,0,.031),(.011,.041,.024),"blue-dark",.0018)
        lab.rod("Conductive graphite clamp",(x-.006,-.006,.038),(x+.006,-.006,.038),.0041,"brass",16)
        lab.rod("Guide-rail clamp",(x-.006,.012,.045),(x+.006,.012,.045),.0035,"chrome",16)
    lab.rod("Exposed graphite core",(-.068,-.006,.038),(.068,-.006,.038),.00275,"ink",24)
    lab.rod("Polished slider guide",(-.069,.012,.045),(.069,.012,.045),.0019,"chrome",20)
    slider = lab.empty("RheostatSlider",(.050,.012,.045))
    lab.rod("Contact brass sleeve",(-.007,0,0),(.007,0,0),.0042,"brass",20,slider)
    lab.block("Thumb grip",(0,-.007,.006),(.016,.021,.009),"blue-light",.0024,slider)
    lab.rod("Flexible pickoff contact",(0,-.006,.003),(0,-.018,-.005),.00125,"brass",12,slider)
    lab.anchor("slider-min",-.050,.012,.051)
    lab.anchor("slider-max",.050,.012,.051)
    lab.text("GRAPHITE",(0,-.025,.0200),.008,"ivory")


def potentiometer(lab):
    board(lab,"Potentiometer mount",.100,.079)
    for name,x,color,label in (("p",-.032,"red","A"),("c",0,"chrome","W"),("n",.032,"ink","B")):
        lab.jack(name,x,-.024,.031,color)
        lab.text(label,(x,-.035,.0201),.0064,"ivory")
        lab.rod("Visible solder terminal",(x,-.019,.023),(x*.50,.005,.031),.0019,"brass",12)
    lab.cylinder("Metal potentiometer can",0,.012,.021,.037,.019,"chrome",36)
    lab.cylinder("Mounting nut",0,.012,.036,.041,.0115,"brass",6)
    dial = lab.empty("PotentiometerKnob",(0,.012,.041))
    lab.cylinder("Knurled user knob",0,0,0,.018,.0123,"ink",32,dial)
    lab.cylinder("Knob cap",0,0,.017,.019,.0117,"blue-dark",32,dial)
    lab.block("Index line",(0,.0057,.0193),(.0018,.007,.00055),"ivory",.0002,dial)
    for i in range(11):
        a=radians(215-250*i/10)
        lab.block("Position graduation",(.023*cos(a),.012+.023*sin(a),.0199),(.0032,.001,.00024),"ivory",0).rotation_euler.z=a


def calorimeter(lab):
    common.tray(lab,"Joule heating apparatus base",.137,.086,.050,-.022)
    lab.cylinder("Insulating cradle disc",0,.007,.018,.026,.031,"blue-dark",40)
    glass=common.paint(lab,"Glass jar",(.79,.91,.98),.18,0,.25)
    water=common.paint(lab,"Water volume",(.43,.73,.86),.34,0,.26)
    jar = revolved(lab.group,"Open-mouthed calorimeter glass",[(0,.024),(.026,.024),(.030,.028),(.031,.092),
                   (.0295,.096),(.027,.096),(.028,.091),(.027,.030),(0,.030)],glass,sides=44)
    jar.location.y=.007
    liquid=revolved(lab.group,"Water fill",[(0,.031),(.027,.031),(.027,.074),(0,.074)],water,sides=36)
    liquid.location.y=.007
    lab.cylinder("Insulated calorimeter lid",0,.007,.093,.100,.0317,"blue-dark",40)
    lab.rod("Glass thermometer stem",(.013,.008,.059),(.013,.008,.126),.0025,"ivory",20)
    lab.rod("Thermometer liquid column",(.014,.006,.071),(.014,.006,.111),.00065,"red",12)
    for x in (-.011,.011):
        lab.rod("Heating element vertical electrode",(x,.003,.050),(x,.003,.105),.0019,"chrome",14)
    verts, faces, rows, sides = [], [], 61, 8
    for i in range(rows):
        a = tau*i/12
        for j in range(sides):
            b = tau*j/sides
            r = .0033+.00057*cos(b)
            verts.append((-.011+.022*i/(rows-1)+.00057*sin(b),.003+r*cos(a),.051+r*sin(a)))
        if i:
            for j in range(sides):
                k = (j+1)%sides
                faces.append(((i-1)*sides+j,(i-1)*sides+k,i*sides+k,i*sides+j))
    heater = mesh(lab.group,"Continuous immersed heating coil",verts,faces,lab.mats["coil"])
    for face in heater.data.polygons:
        face.use_smooth = True
    lab.rod("Left electrical lead",(-.045,-.022,.026),(-.011,.003,.100),.0015,"red",16)
    lab.rod("Right electrical lead",(.045,-.022,.026),(.011,.003,.100),.0015,"ink",16)


def bare_motor(lab):
    common.tray(lab,"Motor specimen support",.104,.074,.036,-.021)
    lab.block("Molded motor saddle",(0,.010,.024),(.059,.032,.014),"blue-dark",.0025)
    lab.rod("Rolled steel motor casing",(-.027,.009,.040),(.024,.009,.040),.0185,"chrome",40)
    lab.rod("Pressed motor front plate",(-.031,.009,.040),(-.026,.009,.040),.0165,"gray",36)
    lab.rod("Insulated brush end cap",(.024,.009,.040),(.030,.009,.040),.0178,"blue-dark",36)
    spindle=lab.empty("MotorRotor",(-.031,.009,.040))
    lab.rod("Exposed motor spindle",(-.021,0,0),(0,0,0),.00245,"chrome",18,spindle)
    lab.rod("Spindle coupling flag",(-.016,0,0),(-.016,.006,0),.00165,"red",12,spindle)
    for y,mat in ((0,"red"),(.019,"ink")):
        lab.rod("Exposed motor solder tab",(.029,y,.040),(.036,y,.040),.0027,"brass",12)
        lab.rod("Lead to terminal",(.035,y,.038),((-.035 if mat=="red" else .035),-.020,.023),.0012,mat,12)


def dial_face(lab, panel, kind):
    lab.block("Raised window housing",(0,0,-.001),(.104,.082,.006),"ink",.0032,panel)
    lab.block("Pale printed scale plate",(0,0,.0028),(.098,.074,.002),"dial",.0016,panel)
    y0, radius = -.029,.0445
    var_a = kind=="galvanometer"
    marks, faces = [],[]
    for i in range(31):
        a=radians(146-112*i/30)
        d=.0048 if i%5==0 else .0025
        w=.00032 if i%5==0 else .00019
        faces.append(tuple(range(len(marks),len(marks)+4)))
        for r,t in ((radius-d,-w),(radius,-w),(radius,w),(radius-d,w)):
            marks.append((r*cos(a)-t*sin(a),y0+r*sin(a)+t*cos(a),.0041))
        if i%5==0:
            label = str(i//5-3) if var_a else str(i//5)
            lab.text(label,((radius+.006)*cos(a),y0+(radius+.006)*sin(a),.0042),.0058,"ink",panel)
        if not var_a and i in (10,20,30):
            lab.text(f"{i*.02:.1f}",((radius-.010)*cos(a),y0+(radius-.010)*sin(a),.0042),.0049,"ink",panel)
    mesh(lab.group,"Etched radial graduations",marks,faces,lab.mats["ink"]).parent=panel
    lab.text("mA" if var_a else "V / A",(0,-.007,.0042),.0107,"ink",panel)
    if not var_a:
        lab.text("0–6 V / 0–0.6 A",(0,-.017,.0042),.0055,"ink",panel)
    needle=lab.empty("MeterNeedle",(0,y0,.0056),panel)
    a=radians(90 if var_a else 146)
    c,s=cos(a),sin(a)
    pts=[(r*c-t*s,r*s+t*c,0) for r,t in ((-.0045,-.0012),(.0425,-.00029),(.0442,0),(.0425,.00029),(-.0045,.0012))]
    mesh(lab.group,"Real rotating tapered pointer",pts,[(0,1,2,3,4)],lab.mats["red"]).parent=needle
    lab.cylinder("Central pointer cap",0,y0,.0052,.007,.0032,"ink",20,panel)
    trim(lab,"Meter clear-window gasket",(.100,.078,.0025),.002,.0067,"gray",panel)
    lens=common.paint(lab,"Thin clear window",(.79,.87,.90),.18,0,.09)
    mesh(lab.group,"Protective clear lens",[(-.047,-.036,.008),(.047,-.036,.008),(.047,.036,.008),(-.047,.036,.008)],
         [(0,1,2,3)],lens).parent=panel


def galvanometer(lab):
    common.paint(lab,"dark-shell",(.028,.061,.090),.37)
    case(lab,.108,"dark-shell")
    lab.feet(.041,.040)
    contact=lab.empty("Inclined contact plate",(0,-.037,.025))
    contact.rotation_euler.x=radians(14)
    lab.block("Green terminal plate",(0,0,0),(.089,.026,.0026),"green",.0013,contact)
    lab.jack("p",.032,-.035,.038,"red")
    lab.jack("n",-.032,-.035,.038,"ink")
    lab.text("+",(.032,-.008,.0015),.0077,"ivory",contact)
    lab.text("−",(-.032,-.008,.0015),.0077,"ivory",contact)
    panel=lab.empty("TiltedDial",(0,-.001,.064))
    panel.rotation_euler.x=radians(64)
    dial_face(lab,panel,"galvanometer")


def multimeter(lab):
    lab.feet(.044,.068)
    lab.block("Rubber meter protective case",(0,0,.016),(.116,.169,.028),"blue-dark",.008)
    lab.block("Dark instrument fascia",(0,0,.030),(.109,.161,.005),"ink",.004)
    panel=lab.empty("TiltedDial",(0,.032,.033))
    panel.rotation_euler.x=radians(6)
    dial_face(lab,panel,"multimeter")
    dark=lab.empty("MultimeterSelector",(0,-.033,.034))
    lab.cylinder("Selector bezel",0,-.033,.033,.036,.018,"green",36)
    lab.cylinder("Selector rotating body",0,0,0,.009,.013,"gray",32,dark)
    lab.block("Selector grip ridge",(0,.001,.009),(.007,.018,.004),"blue-light",.0018,dark)
    lab.block("Selector white position mark",(0,.008,.0112),(.0016,.004,.00032),"ivory",0,dark)
    lab.text("V",(-.028,-.038,.0334),.009,"ivory")
    lab.text("A",(.028,-.038,.0334),.009,"ivory")
    lab.jack("p",.031,-.061,.044,"red")
    lab.jack("n",-.031,-.061,.044,"ink")
    lab.text("V/A",(.031,-.073,.0334),.0065,"ivory")
    lab.text("COM",(-.031,-.073,.0334),.0065,"ivory")


GROUP = {
    "resistance-wire": ("导体电阻实验板",resistance_wire,(0,0,.018),.238,(.23,-1,1.26)),
    "resistance-box": ("电阻箱",resistance_box,(0,0,.028),.172,(.27,-1,1.35)),
    "pencil-rheostat": ("铅笔芯变阻器",pencil,(0,0,.025),.216,(.26,-1,1.25)),
    "potentiometer": ("三端旋钮电位器",potentiometer,(0,0,.027),.144,(.30,-1,1.12)),
    "joule-calorimeter": ("焦耳定律量热器",calorimeter,(0,0,.057),.205,(.30,-1,.80)),
    "motor-bare": ("电动机（裸机）",bare_motor,(0,0,.026),.150,(.46,-1,1.19)),
    "galvanometer": ("灵敏电流计",galvanometer,(0,0,.051),.190,(.38,-1,.51)),
    "multimeter": ("指针式多用电表",multimeter,(0,0,.027),.228,(.20,-1,1.83)),
}


if __name__ == "__main__":
    repo = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets",nargs="+",choices=GROUP,default=list(GROUP))
    parser.add_argument("--asset-root",type=Path,default=repo/"assets")
    parser.add_argument("--metadata",type=Path)
    args=parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    for key in args.assets:
        factory.ASSETS[key]=GROUP[key][1:]
        factory.build(key,args.asset_root.resolve()/key/"v1",True)
    if args.metadata:
        records=[]
        for key in args.assets:
            prefix=f"assets/{key}/v1"
            with (args.asset_root/key/"v1"/(key+".glb")).open("rb") as glb:
                header=glb.read(20)
                gltf=json.loads(glb.read(struct.unpack_from("<I",header,12)[0]))
            names={"base","p","n","b","c","slider-min","slider-max"}
            anchors={n["name"]:[round(v,6) for v in n.get("translation",[0,0,0])] for n in gltf["nodes"] if n["name"] in names}
            assert {"base","p","n"}<=anchors.keys()
            records.append(dict(id=key,title=GROUP[key][0],version=1,status="candidate",source=f"{prefix}/{key}.blend",
                                model=f"{prefix}/{key}.glb",preview=f"{prefix}/preview.png",anchors=anchors,
                                provenance="参考旧版电学器材库的形状及用途，原创重绘 Blender 网格，未嵌入原图。"))
        args.metadata.parent.mkdir(parents=True,exist_ok=True)
        args.metadata.write_text(json.dumps(records,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
