"""Inspect a .blend: objects, armatures, animations, materials, textures, sizes.
Run: blender --background --python scripts/blender_inspect.py -- <file.blend>
"""
import bpy, sys

argv = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.open_mainfile(filepath=argv[0])

print("\n==== OBJECTS ====")
for o in bpy.data.objects:
    dims = tuple(round(d, 3) for d in o.dimensions)
    par = o.parent.name if o.parent else None
    print(f"  [{o.type}] {o.name!r} dims={dims} parent={par}")

print("\n==== ARMATURES ====", [a.name for a in bpy.data.armatures])

print("\n==== ACTIONS / ANIMATIONS ====")
for a in bpy.data.actions:
    print(f"  {a.name!r} frames={tuple(round(f) for f in a.frame_range)}")

print("\n==== MATERIALS ====", [m.name for m in bpy.data.materials])

print("\n==== IMAGES / TEXTURES ====")
for img in bpy.data.images:
    if img.name == 'Render Result':
        continue
    state = 'packed' if img.packed_file else 'EXTERNAL'
    print(f"  {img.name!r} size={tuple(img.size)} {state} path={img.filepath!r}")

print("\n==== COLLECTIONS ====", [c.name for c in bpy.data.collections])
print("\n==== SCENE ====", bpy.context.scene.name, "objects:", len(bpy.context.scene.objects))
