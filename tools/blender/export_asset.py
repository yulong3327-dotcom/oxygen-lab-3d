"""Export the instrument collection from the open .blend to a GLB."""

import argparse
from pathlib import Path
import sys

import bpy


def export_asset(output, collection_name="ASSET"):
    collection = bpy.data.collections.get(collection_name)
    if collection is None or not collection.all_objects:
        raise ValueError(f"Missing or empty collection: {collection_name}")
    if not any(obj.type == "MESH" for obj in collection.all_objects):
        raise ValueError(f"No meshes found in {collection_name}")
    if bpy.context.scene.unit_settings.system != "METRIC" or bpy.context.scene.unit_settings.scale_length != 1:
        raise ValueError("Set the scene to Metric with unit scale 1 (meters)")

    output = Path(output).resolve()
    if output.suffix.lower() != ".glb":
        raise ValueError("Output must have the .glb extension")
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in collection.all_objects:
        if obj.type not in {"MESH", "EMPTY"}:
            raise ValueError(f"Keep only mesh and anchor objects in {collection_name}: {obj.name}")
        if obj.name not in bpy.context.view_layer.objects or not obj.visible_get():
            raise ValueError(f"Unhide {obj.name} in the active view layer before exporting")
        if obj.parent is not None and obj.parent not in collection.all_objects[:]:
            raise ValueError(f"Keep {obj.name}'s parent inside {collection_name}")
        obj.select_set(True)

    result = bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        export_yup=True,
        use_selection=True,
        export_apply=True,
        export_animations=False,
    )
    if 'FINISHED' not in result:
        raise RuntimeError(f"GLB export did not finish: {output}")
    print(f"Exported {output} ({output.stat().st_size} bytes)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--collection", default="ASSET")
    opts = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    export_asset(opts.output, opts.collection)
