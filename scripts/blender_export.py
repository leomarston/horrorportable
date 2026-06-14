"""Export only the DarkFox character (mesh + deform rig) to GLB.
Excludes Rigify widgets (WGT-*), the metarig, the backdrop Plane and lights.
Run: blender --background --python scripts/blender_export.py -- <in.blend> <out.glb>
"""
import bpy, sys

argv = sys.argv[sys.argv.index('--') + 1:]
in_path, out_path = argv[0], argv[1]

bpy.ops.wm.open_mainfile(filepath=in_path)

try:
    bpy.ops.file.pack_all()  # bundle textures into the file so they export
except Exception as e:
    print("pack_all skipped:", e)

keep = []
for o in bpy.context.scene.objects:
    n = o.name
    if o.type == 'ARMATURE' and n == 'rig':
        keep.append(o)
    elif o.type == 'MESH' and not n.startswith('WGT-') and n != 'Plane':
        keep.append(o)

bpy.ops.object.select_all(action='DESELECT')
for o in keep:
    try:
        o.hide_set(False)
    except Exception:
        pass
    o.hide_viewport = False
    o.select_set(True)
bpy.context.view_layer.objects.active = keep[0]

print("EXPORTING:", [o.name for o in keep])
bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format='GLB',
    use_selection=True,
    export_apply=False,
    export_yup=True,
    export_animations=True,
    export_skins=True,
    export_def_bones=True,       # deform bones only → clean skeleton, no Rigify control clutter
    export_hierarchy_flatten_bones=False,
    export_morph=True,
    export_materials='EXPORT',
    export_cameras=False,
    export_lights=False,
)
print("EXPORTED ->", out_path)
