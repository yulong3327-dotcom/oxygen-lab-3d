"""Build oxygen lab apparatus, export its web meshes, and render a Cycles review image.

Run with blender --background --factory-startup --python-exit-code 1 --python
tools/blender/build_oxygen_glass.py -- <output directory>.
"""

import base64
import json
import math
from pathlib import Path
import struct
import sys

import bmesh
import bpy
from mathutils import Vector


def make_shell(name, rings, material, closed=False):
    vertices, faces, rows = [], [], []
    for ring in rings:
        rows.append(list(range(len(vertices), len(vertices) + len(ring))))
        # Convert Y-up web coordinates to Blender's Z-up coordinates.
        vertices.extend((x, -z, y) for x, y, z in ring)
    for a, b in zip(rows, rows[1:] + (rows[:1] if closed else [])):
        count = max(len(a), len(b))
        for i in range(count):
            j = (i + 1) % count
            if len(a) == 1:
                faces.append((a[0], b[j], b[i]))
            elif len(b) == 1:
                faces.append((a[i], a[j], b[0]))
            else:
                faces.append((a[i], a[j], b[j], b[i]))
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    editable = bmesh.new()
    editable.from_mesh(data)
    bmesh.ops.recalc_face_normals(editable, faces=list(editable.faces))
    if not all(edge.is_manifold for edge in editable.edges):
        raise ValueError(f"{name} has an open seam")
    editable.to_mesh(data)
    editable.free()
    for face in data.polygons:
        face.use_smooth = True
    ob = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(ob)
    data.materials.append(material)
    return ob


def revolve(profile, sides=64):
    return [
        [(0, y, 0)] if r == 0 else [
            (r * math.cos(i * math.tau / sides), y, r * math.sin(i * math.tau / sides))
            for i in range(sides)
        ]
        for r, y in profile
    ]


def round_box(width, length, radius, y):
    if width == 0:
        return [(0, y, 0)]
    ring = []
    for i, (sx, sz) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        for j in range(9):
            angle = (i + j / 8) * math.pi / 2
            ring.append((sx * (width / 2 - radius) + radius * math.cos(angle), y,
                         sz * (length / 2 - radius) + radius * math.sin(angle)))
    return ring


def glass(name, tint, roughness):
    material, surface = principled(name, tint, roughness)
    surface.inputs['Transmission Weight'].default_value = 1
    surface.inputs['IOR'].default_value = 1.48
    return material


def principled(name, tint, roughness, metalness=0):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*tint, 1)
    material.use_nodes = True
    surface = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    surface.inputs['Base Color'].default_value = (*tint, 1)
    surface.inputs['Roughness'].default_value = roughness
    surface.inputs['Metallic'].default_value = metalness
    return material, surface


def rounded_part(name, size, bevel, material):
    bpy.ops.mesh.primitive_cube_add(size=1)
    ob = bpy.context.object
    ob.name = name
    ob.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ob.data.materials.append(material)
    modifier = ob.modifiers.new('Rounded machined edges', 'BEVEL')
    modifier.width = bevel
    modifier.segments = 3
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    for face in ob.data.polygons:
        face.use_smooth = True
    normal = ob.modifiers.new('Weighted face normals', 'WEIGHTED_NORMAL')
    bpy.ops.object.modifier_apply(modifier=normal.name)
    return ob


def binary(fmt, values):
    return base64.b64encode(struct.pack(f'<{len(values)}{fmt}', *values)).decode('ascii')


def export_web(objects, output):
    meshes = {}
    for name, ob in objects.items():
        mesh = ob.data
        mesh.calc_loop_triangles()
        positions, normals, indices, uv = [], [], [], []
        corners = {}
        uv_layer = mesh.uv_layers.active
        for triangle in mesh.loop_triangles:
            for i, v in zip(triangle.loops, triangle.vertices):
                normal = mesh.corner_normals[i].vector
                quantized = tuple(round(n * 127) for n in (normal.x, normal.z, -normal.y))
                coordinates = tuple(uv_layer.data[i].uv) if uv_layer else (0, 0)
                key = v, quantized, coordinates
                if key not in corners:
                    corners[key] = len(corners)
                    x, y, z = mesh.vertices[v].co
                    positions.extend((x, z, -y))
                    normals.extend(quantized)
                    uv.extend(coordinates)
                indices.append(corners[key])
        meshes[name] = dict(position=binary('f', positions), normal=binary('b', normals), index=binary('H', indices))
        if uv_layer:
            meshes[name]['uv'] = binary('f', uv)
        surface = next(node for node in mesh.materials[0].node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
        meshes[name]['material'] = {
            'baseColor': [round(value, 6) for value in surface.inputs['Base Color'].default_value[:3]],
            'roughness': round(surface.inputs['Roughness'].default_value, 6),
            'metalness': round(surface.inputs['Metallic'].default_value, 6),
            'clearcoat': round(surface.inputs['Coat Weight'].default_value, 6),
        }
    payload = ',\n'.join(f'  {name}: {json.dumps(mesh)}' for name, mesh in meshes.items())
    output.write_text('// Generated by tools/blender/build_oxygen_glass.py. Do not edit.\n'
                      f'globalThis.oxygenGlassModels = Object.freeze({{\n{payload}\n}});\n', encoding='utf-8')


def aim(ob, point):
    ob.rotation_euler = (Vector(point) - ob.location).to_track_quat('-Z', 'Y').to_euler()


def studio_render(objects, output):
    tube, jar, tank, lamp = (objects[name] for name in ('tube', 'jar', 'tank', 'lamp'))
    tube.location = (-3.15, 0, 1.21)
    tube.rotation_euler.y = 1.37
    jar.location = (1.2, 1.05, 3.55)
    jar.rotation_euler.y = math.pi
    objects['jarPlate'].location = (1.2, 1.05, 3.10)
    tank.location = (2.1, -.93, 0)
    lamp.location = (-2.04, -1.23, 0)
    for name, location in {
        'standBase': (-3.22, .58, .16), 'standRod': (-3.22, .58, 1.9),
        'standSocket': (-3.22, .58, .31), 'clampBlock': (-3.22, .58, 1.39),
        'clampKnob': (-3.54, .58, 1.39), 'stopper': (.20, -.1, 1.88),
        'lampCap': (-1.17, -1.36, 0), 'wickSeat': (-2.04, -1.23, 0),
        'matchBox': (-2.65, -2.03, .12), 'rackRail': (2.1, -.93, .40),
    }.items():
        objects[name].location = location
    objects['stopper'].rotation_euler.y = 1.37
    bpy.ops.mesh.primitive_plane_add(size=200)
    floor = bpy.context.object
    floor.location.z = -.02
    material = bpy.data.materials.new('Laboratory surface')
    material.use_nodes = True
    surface = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    surface.inputs['Base Color'].default_value = (.16, .22, .25, 1)
    surface.inputs['Roughness'].default_value = .32
    floor.data.materials.append(material)
    for name, position, energy, size, size_y, rgb in (
        ('Key softbox', (-4, -3.5, 6.2), 1100, 4.5, 2.7, (1, .92, .79)),
        ('Cool rim', (3.8, 3, 5), 1500, 4.0, 2.1, (.77, .88, 1)),
        ('Overhead fill', (0, -1.3, 7), 530, 5.5, 3.7, (1, 1, 1)),
    ):
        light = bpy.data.lights.new(name, 'AREA')
        light.energy, light.shape, light.size, light.size_y, light.color = energy, 'RECTANGLE', size, size_y, rgb
        ob = bpy.data.objects.new(name, light)
        bpy.context.collection.objects.link(ob)
        ob.location = position
        aim(ob, (0, 0, .8))
    camera = bpy.data.objects.new('Glassware review', bpy.data.cameras.new('Glassware review'))
    bpy.context.collection.objects.link(camera)
    camera.location = (8.9, -15.5, 8.5)
    aim(camera, (.05, 0, 1.0))
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 10
    scene = bpy.context.scene
    scene.camera = camera
    scene.world.use_nodes = True
    world_surface = next(node for node in scene.world.node_tree.nodes if node.type == 'BACKGROUND')
    world_surface.inputs['Color'].default_value = (.41, .48, .56, 1)
    world_surface.inputs['Strength'].default_value = .44
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.cycles.transmission_bounces = 10
    scene.render.resolution_x, scene.render.resolution_y = 1200, 720
    scene.render.resolution_percentage = 100
    scene.render.filepath = str(output / 'apparatus-cycles.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'apparatus.blend'))
    bpy.ops.render.render(write_still=True)


def main(output):
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    thin = glass('Clear borosilicate', (.985, .996, .994), .035)
    thick = glass('Thick clear glass', (.955, .985, .976), .052)
    length = math.hypot(3.63, .35)
    tube_profile = [(.344 * math.sin(i * math.pi / 36), -.344 * math.cos(i * math.pi / 36)) for i in range(19)]
    tube_profile += [(.344, length - .047), (.345, length - .018), (.338, length + .008),
                     (.324, length + .018), (.308, length + .008), (.299, length - .016), (.299, length - .049)]
    tube_profile += [(.299 * math.sin(i * math.pi / 36), .018 - .299 * math.cos(i * math.pi / 36)) for i in range(18, -1, -1)]
    # Local Y increases from the mouth down to the base. Keep the sealing face at .47.
    jar_neck = [
        (.456, .55), (.456, .497), (.459, .479), (.468, .470), (.481, .470),
        (.556, .470), (.572, .470), (.581, .478), (.586, .492), (.582, .505),
        (.569, .526), (.551, .540), (.517, .554), (.505, .569), (.503, .586),
        (.503, .830), (.507, .876), (.523, .925), (.559, .964), (.624, 1.017),
        (.692, 1.083), (.738, 1.155), (.762, 1.232), (.770, 1.306),
    ]
    jar_profile = [
        (0, 3.302), (.51, 3.302), (.60, 3.30), (.664, 3.279), (.711, 3.232),
        (.726, 3.16), (.728, 1.306), (.718, 1.232), (.694, 1.155), (.646, 1.083),
        (.582, 1.017), (.517, .964), (.482, .925), (.463, .876), (.456, .830),
    ] + jar_neck + [
        (.77, 3.17), (.767, 3.25), (.741, 3.32), (.693, 3.367), (.622, 3.392),
        (.55, 3.40), (.18, 3.40), (0, 3.40),
    ]
    tank_profile = [(0, 0, 0, .104), (4.12, 2.72, .19, .104), (4.20, 2.80, .19, .105),
                    (4.25, 2.85, .20, .129), (4.26, 2.86, .20, .161), (4.25, 2.85, .20, .192),
                    (4.25, 2.85, .20, .878), (4.28, 2.88, .22, .902), (4.28, 2.88, .22, .926),
                    (4.25, 2.85, .20, .947), (4.17, 2.77, .16, .949), (4.11, 2.71, .15, .931),
                    (4.10, 2.70, .145, .898), (4.10, 2.70, .145, .222), (4.085, 2.685, .14, .18),
                    (4.0, 2.60, .12, .158), (3.94, 2.54, .11, .155), (0, 0, 0, .155)]
    lamp_profile = [(0, .044), (.295, .044), (.353, .053), (.39, .08), (.433, .19), (.475, .33),
                    (.513, .45), (.521, .52), (.511, .578), (.480, .630), (.432, .676), (.360, .718),
                    (.284, .754), (.220, .786), (.176, .835), (.156, .891), (.160, .918), (.181, .927),
                    (.185, .948), (.181, .975), (.171, .990), (.143, .990), (.131, .977), (.126, .954),
                    (.130, .891), (.149, .824), (.198, .775), (.268, .729), (.348, .681), (.419, .630),
                    (.471, .573), (.481, .515), (.456, .423), (.422, .29), (.386, .154), (.358, .113),
                    (.308, .101), (0, .101)]
    objects = {
        'tube': make_shell('Test tube', revolve(tube_profile), thin),
        'jar': make_shell('Gas jar', revolve(jar_profile), thick),
        'jarPlate': rounded_part('Square glass cover', (1.27, .04, 1.27), .009, thin),
        'tank': make_shell('Water tank', [round_box(*row) for row in tank_profile], thick),
        'lamp': make_shell('Spirit lamp reservoir', revolve(lamp_profile), thick),
    }
    cast, cast_surface = principled('Textured cast iron', (.048, .057, .064), .75, .32)
    noise = cast.node_tree.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 170
    bump = cast.node_tree.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .22
    bump.inputs['Distance'].default_value = .009
    cast.node_tree.links.new(noise.outputs['Fac'], bump.inputs['Height'])
    cast.node_tree.links.new(bump.outputs['Normal'], cast_surface.inputs['Normal'])
    steel, _ = principled('Satin steel', (.51, .55, .59), .24, .93)
    rubber, _ = principled('Molded rubber', (.028, .031, .032), .83)
    ceramic, ceramic_surface = principled('Glazed porcelain', (.83, .81, .74), .22)
    ceramic_surface.inputs['Coat Weight'].default_value = .27
    board, _ = principled('Pressed cardboard', (.48, .31, .18), .9)
    objects.update({
        'standBase': rounded_part('Cast iron base', (1.75, .177, 1.44), .044, cast),
        'standRod': make_shell('Steel support rod', revolve([(0, -1.625), (.072, -1.625), (.082, -1.613),
            (.082, 1.611), (.075, 1.625), (0, 1.625)], 40), steel),
        'standSocket': make_shell('Steel rod socket', revolve([(0, -.08), (.194, -.08), (.205, -.064),
            (.199, -.027), (.187, .068), (.177, .08), (0, .08)], 40), steel),
        'clampBlock': rounded_part('Cast clamp boss', (.37, .33, .32), .039, cast),
        'clampKnob': rounded_part('Clamp knob', (.072, .217, .192), .022, steel),
        'stopper': make_shell('Bored rubber stopper', revolve([(.081, -.14), (.225, -.142), (.247, -.132),
            (.251, -.106), (.28, .108), (.285, .129), (.277, .143), (.090, .143), (.080, .127)], 48), rubber, closed=True),
        'wickSeat': make_shell('Porcelain wick collar', revolve([(.05, .922), (.133, .922), (.144, .935),
            (.142, .959), (.130, .984), (.104, 1.007), (.057, 1.016), (.047, 1.004)], 48), ceramic, closed=True),
        'lampCap': make_shell('Hollow porcelain snuffer', revolve(list(reversed([(.209, 0), (.225, .007), (.226, .025),
            (.214, .039), (.208, .067), (.199, .26), (.190, .319), (.167, .376), (.133, .411),
            (.081, .440), (.031, .450), (0, .451)])) + [(.190, 0), (.185, .025), (.184, .065),
            (.177, .273), (.160, .343), (.125, .387), (.079, .411), (0, .420)], 56), ceramic),
        'rackRail': rounded_part('Bottle support rail', (1.11, .041, .11), .012, steel),
        'matchBox': rounded_part('Matchbox sleeve', (.89, .23, .52), .021, board),
    })
    export_web(objects, output / 'oxygen-glass-models.js')
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects.values():
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(output / 'apparatus.glb'), use_selection=True)
    studio_render(objects, output)


if __name__ == '__main__':
    main(Path(sys.argv[sys.argv.index('--') + 1]).resolve())
