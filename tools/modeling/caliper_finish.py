"""Acabados originales del calibre. Sin imágenes externas: semilla fija y mapas PBR empacados.

El tamaño en centímetros de cada muestra determina el paso del cepillado. El patrón
se calcula en píxeles periódicos para que las piezas largas repitan sin costuras.
"""
import math
import struct
import zlib
from pathlib import Path
from tempfile import TemporaryDirectory

import bpy
import numpy as np


SIZE = 256
Y, X = np.mgrid[0:SIZE, 0:SIZE]
U, V = (X + 0.5) / SIZE, (Y + 0.5) / SIZE
# Ancho y alto físicos de una repetición en la pieza antes de normalizar la biela.
SPANS = {"brushed": (2.4, 3.2), "oxide": (2.4, 3.2), "contact": (0.80, 5.6),
         "turned": (1.6, 1.6), "bronze": (1.2, 2.0)}


def smooth_noise(rng, nx, ny):
    """Ruido de superficie toroidal en dos escalas independientes."""
    values = rng.uniform(-1, 1, (ny, nx))
    x, y = U * nx, V * ny
    ix, iy = x.astype(int), y.astype(int)
    fx, fy = x - ix, y - iy
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    lower = values[iy, ix] * (1 - fx) + values[iy, (ix + 1) % nx] * fx
    upper = values[(iy + 1) % ny, ix] * (1 - fx) + values[(iy + 1) % ny, (ix + 1) % nx] * fx
    return lower * (1 - fy) + upper * fy


def score_lines(rng):
    """Rayas finas de arrastre, de longitud y deriva variables."""
    field = np.zeros((SIZE, SIZE))
    for _ in range(32):
        dy = (Y - rng.uniform(0, SIZE) + SIZE / 2) % SIZE - SIZE / 2
        dx = (X - rng.uniform(0, SIZE) - dy * rng.normal(0, 0.045) + SIZE / 2) % SIZE - SIZE / 2
        taper = np.maximum(0, 1 - (dy / rng.uniform(16, 76)) ** 2)
        width = rng.uniform(0.40, 1.05)
        field += np.exp(-(dx / width) ** 2) * taper * rng.uniform(0.4, 1)
    return field.clip(0, 1.2)


def maps(kind, linear_color, roughness, metallic):
    rng = np.random.default_rng(9027 + list(SPANS).index(kind))
    fine = smooth_noise(rng, 124, 9)
    grain = 0.64 * fine + 0.36 * smooth_noise(rng, 63, 24)
    field = smooth_noise(rng, 8, 9)
    score = score_lines(rng)
    if kind == "turned":
        # Huellas concéntricas de torneado sobre la cabeza del pasador.
        radius = np.hypot(U - 0.5, V - 0.5)
        grain = 0.27 * fine + 0.73 * np.cos(radius * 138 * math.tau + 0.42 * field)
    polish = np.zeros_like(field)
    if kind == "contact":
        # Dos pistas distintas con el pulido concentrado al centro de cada cara exterior.
        polish = np.exp(-((U - 0.5) / 0.28) ** 4 - ((V - 0.5) / 0.33) ** 4)
    oxidation = np.maximum(field - 0.33, 0) if kind == "oxide" else 0
    tone = 1 + 0.086 * grain + 0.055 * field - 0.13 * score + 0.20 * polish
    color = np.clip(np.array(linear_color) * tone[..., None], 0, 1)
    color[..., 0] += 0.017 * oxidation
    # Albedo en sRGB; los demás mapas usan canales lineales.
    albedo = np.where(color < 0.0031308, color * 12.92, 1.055 * color ** (1 / 2.4) - 0.055)
    rough = np.clip(roughness + 0.105 * grain + 0.040 * field + 0.14 * score - 0.19 * polish, 0.10, 0.88)
    metal = np.clip(metallic - 0.20 * oxidation - 0.055 * score, 0, 1)
    orm = np.stack((np.ones_like(rough), rough, metal), axis=-1)
    width, length = SPANS[kind]
    height_cm = (0.00085 * grain - 0.0018 * score) * (1 - 0.48 * polish)
    du = (np.roll(height_cm, -1, 1) - np.roll(height_cm, 1, 1)) * SIZE / (2 * width)
    dv = (np.roll(height_cm, -1, 0) - np.roll(height_cm, 1, 0)) * SIZE / (2 * length)
    normal = np.stack((-du, dv, np.ones_like(du)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    return {"Albedo": albedo, "MetalRough": orm, "Normal": normal * 0.5 + 0.5}


def write_png(path, pixels):
    def chunk(tag, payload):
        return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", zlib.crc32(tag + payload))

    rgb = np.rint(np.clip(pixels, 0, 1) * 255).astype(np.uint8)
    # Filtro Sub (cada canal guarda la diferencia respecto del píxel anterior).
    filtered = rgb.copy()
    filtered[:, 1:] -= rgb[:, :-1]
    rows = b"".join(b"\x01" + row.tobytes() for row in filtered)
    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
                     + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))


def finish(material, kind, color, roughness, metallic):
    material["finish_kind"] = kind
    tree = material.node_tree
    shader = tree.nodes.get("Principled BSDF")
    with TemporaryDirectory() as folder:
        for index, (slot, pixels) in enumerate(maps(kind, color, roughness, metallic).items()):
            path = Path(folder) / f"{kind}_{slot}.png"
            write_png(path, pixels)
            image = bpy.data.images.load(str(path))
            image.colorspace_settings.name = "sRGB" if slot == "Albedo" else "Non-Color"
            image.pack()
            texture = tree.nodes.new("ShaderNodeTexImage")
            texture.image = image
            texture.location = (-650, 280 - 300 * index)
            if slot == "Albedo":
                tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
            elif slot == "MetalRough":
                channels = tree.nodes.new("ShaderNodeSeparateColor")
                channels.location = (-350, -20)
                tree.links.new(texture.outputs["Color"], channels.inputs[0])
                tree.links.new(channels.outputs["Green"], shader.inputs["Roughness"])
                tree.links.new(channels.outputs["Blue"], shader.inputs["Metallic"])
            else:
                mapping = tree.nodes.new("ShaderNodeNormalMap")
                mapping.location = (-350, -280)
                tree.links.new(texture.outputs["Color"], mapping.inputs["Color"])
                tree.links.new(mapping.outputs["Normal"], shader.inputs["Normal"])


def physical_uv(obj, contact, brushed):
    """Proyección métrica de taller sobre cada pieza, después de sus chaflanes."""
    mesh = obj.data
    while mesh.uv_layers:
        mesh.uv_layers.remove(mesh.uv_layers[0])
    uvs = mesh.uv_layers.new(name="MachiningUV")
    transform = obj.matrix_world
    normal_transform = transform.to_3x3().inverted().transposed()
    if contact in mesh.materials[:]:
        mesh.materials.append(brushed)
    for face in mesh.polygons:
        n = (normal_transform @ face.normal).normalized()
        material = mesh.materials[face.material_index]
        if material == contact and n.x < 0.55:
            # Los cantos y el dorso de la zapata conservan el satinado original.
            face.material_index = mesh.materials.find(brushed.name)
            material = brushed
        kind = material.get("finish_kind", "brushed")
        width, length = SPANS[kind]
        for i in face.loop_indices:
            x, y, z = transform @ mesh.vertices[mesh.loops[i].vertex_index].co
            if kind == "contact":
                # Centrar en la banda de desgaste, entre sus bordes Y=±0,19 y ±0,76.
                u, v = (y - math.copysign(0.475, y)) / width + 0.5, z / length + 0.5
            elif kind == "turned" and abs(n.y) > 0.7:
                center = transform.translation
                u, v = (x - center.x) / width + 0.5, (z - center.z) / length + 0.5
            elif abs(n.z) > max(abs(n.x), abs(n.y)):
                u, v = x / width, y / length
            else:
                u, v = (y if abs(n.x) > abs(n.y) else x) / width, z / length
            uvs.data[i].uv = (u, v)
