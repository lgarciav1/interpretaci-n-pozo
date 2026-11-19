"""Reconstruir con blender -b -P tools/modeling/caliper.py [-- /ruta/calibre.blend].

Modelo ilustrativo del mecanismo de contacto de un calibre de pozo. Medidas en cm de
escena, independientes de un fabricante. La escena web conserva el cuerpo de la sarta.
El GLB contiene tres piezas con origen propio. En glTF, +X apunta a la pared, +Y es el
eje del pozo y Z es el eje de giro. El brazo está normalizado entre Y=0 y Y=1 para
que la escena aplique la longitud del montaje sin cambiar el ancho de acero.
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
GLB = ROOT / "src/app/toolString/assets/caliper.glb"
LINK_LENGTH = 16.0
bpy.ops.wm.read_factory_settings(use_empty=True)


def metal(name, color, roughness, metallic=0.9):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1)
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    return material


steel = metal("Acero satinado", (0.48, 0.53, 0.57), 0.31)
dark = metal("Acero pavonado", (0.10, 0.13, 0.15), 0.35)
wear = metal("Patín de desgaste", (0.65, 0.68, 0.67), 0.23)
bushing = metal("Casquillo de bronce", (0.46, 0.28, 0.11), 0.36)
socket = metal("Interior de tornillo", (0.032, 0.038, 0.041), 0.57)


def chamfer(obj, width):
    if width:
        bevel = obj.modifiers.new("Chaflán de mecanizado", "BEVEL")
        bevel.width = width
        bevel.segments = 2
        bevel.harden_normals = True
        normals = obj.modifiers.new("Normales ponderadas", "WEIGHTED_NORMAL")
        normals.keep_sharp = True
    return obj


def plate(name, outline, y0, y1, material, bevel=0.04):
    """Perfil X/Z, extruido entre las dos caras laterales del mecanismo."""
    count = len(outline)
    vertices = [(x, y, z) for y in (y0, y1) for x, z in outline]
    faces = [list(range(count)), list(reversed(range(count, 2 * count)))]
    for i in range(count):
        j = (i + 1) % count
        faces.append((i, i + count, j + count, j))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(material)
    return chamfer(obj, bevel)


def pin(name, x, y, z, r, depth, material, sides=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=r, depth=depth,
                                       location=(x, y, z), rotation=(math.pi / 2, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = len(polygon.vertices) == 4
    return chamfer(obj, min(0.026, depth / 5))


def allen_pin(x, z, span, r):
    parts = [pin("Eje pasante", x, 0, z, r, span, steel)]
    for side in (-1, 1):
        end = side * span / 2
        parts.append(pin("Arandela de apoyo", x, end, z, r * 1.16, 0.08, bushing))
        parts.append(pin("Cabeza de eje", x, end + side * 0.07, z, r, 0.09, wear))
        parts.append(pin("Alojamiento hexagonal", x, end + side * 0.119, z, r * 0.48, 0.012, socket, 6))
    return parts


def component(name, parts):
    # Congelar los chaflanes y combinar materiales en un único nodo de malla por pieza.
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj


# Biela aligerada de doble mejilla con nervio y casquillos en los dos ojos.
link_parts = []
body = [(-0.40, -0.33), (0.31, -0.33), (0.51, -0.04), (0.43, 0.48),
        (0.24, 1.20), (0.24, 14.80), (0.44, 15.52), (0.48, 16.06),
        (0.25, 16.30), (-0.31, 16.30), (-0.49, 16.03), (-0.44, 15.49),
        (-0.22, 14.82), (-0.22, 1.22), (-0.47, 0.49), (-0.50, -0.04)]
for side in (-1, 1):
    edge = sorted((side * 0.43, side * 0.59))
    link_parts.append(plate("Mejilla fresada", body, *edge, steel))
web = [(-0.14, 0.82), (0.14, 0.82), (0.18, 1.35), (0.18, 14.65),
       (0.14, 15.18), (-0.14, 15.18), (-0.18, 14.65), (-0.18, 1.35)]
link_parts.append(plate("Alma de biela", web, -0.44, 0.44, dark))
for z in (0, LINK_LENGTH):
    link_parts.append(pin("Casquillo de ojo", 0, 0, z, 0.32, 1.22, bushing))
link = component("CaliperLink", link_parts)

# Bloque de horquilla que apoya el pasador en el cuerpo de la herramienta.
pivot_parts = allen_pin(0, 0, 1.92, 0.34)
bracket = [(-0.86, -0.83), (-0.57, -0.83), (0.28, -0.40), (0.44, -0.18),
           (0.44, 0.18), (0.28, 0.40), (-0.57, 0.83), (-0.86, 0.83)]
for low, high in [(-0.92, -0.62), (0.62, 0.92)]:
    pivot_parts.append(plate("Oreja de horquilla", bracket, low, high, dark))
pivot = component("CaliperPivot", pivot_parts)

# Zapata de contacto con nariz redondeada y dos bandas longitudinales de desgaste.
# El plano más exterior está en X = 0, el centro del pasador en X = -0,75.
shoe_parts = []
carrier = [(-0.98, -2.20), (-0.65, -2.42), (-0.43, -2.40), (-0.18, -1.70),
           (-0.15, 1.70), (-0.43, 2.40), (-0.65, 2.42), (-0.98, 2.20)]
shoe_parts.append(plate("Portazapata", carrier, -0.54, 0.54, dark, 0.08))
skid = [(-0.63, -2.48), (-0.45, -2.50), (-0.19, -2.17), (0, -1.44),
        (0, 1.44), (-0.19, 2.17), (-0.45, 2.50), (-0.63, 2.48),
        (-0.38, 1.66), (-0.38, -1.66)]
for low, high in [(-0.76, -0.19), (0.19, 0.76)]:
    shoe_parts.append(plate("Banda de desgaste", skid, low, high, wear, 0.035))
shoe_parts.extend(allen_pin(-0.75, 0, 1.55, 0.23))
shoe = component("CaliperShoe", shoe_parts)

# La fuente .blend se entrega en pose abierta, a tamaño de taller, editable por pieza.
if "--" in sys.argv:
    blend = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
    angle = math.radians(34)
    link.rotation_euler.y = angle
    shoe.location = (LINK_LENGTH * math.sin(angle) + 0.75, 0, LINK_LENGTH * math.cos(angle))
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 0.01
    bpy.context.scene.unit_settings.length_unit = "CENTIMETERS"
    for area in bpy.context.screen.areas:
        if area.type == "VIEW_3D":
            region = area.spaces.active.region_3d
            region.view_location = (3, 0, 6)
            region.view_distance = 27
            region.view_rotation = Vector((-0.34, -1, -0.22)).to_track_quat("-Z", "Y")
            area.spaces.active.shading.color_type = "MATERIAL"
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))

# La aplicación coloca las tres piezas por sus pivotes y convierte largo axial a escena.
link.rotation_euler.y = 0
shoe.location = (0, 0, 0)
bpy.context.scene.unit_settings.system = "NONE"
bpy.context.scene.unit_settings.scale_length = 1
link.data.transform(Matrix.Diagonal((1, 1, 1 / LINK_LENGTH, 1)))
GLB.parent.mkdir(exist_ok=True, parents=True)
bpy.ops.export_scene.gltf(filepath=str(GLB), export_format="GLB", export_yup=True,
                          export_texcoords=False, export_cameras=False, export_lights=False)
