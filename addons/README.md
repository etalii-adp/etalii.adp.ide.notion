# Notion add-ons

Each Notion add-on is one folder here, named by the id of its tool type: lowercase letters and digits, with dashes between words. The folder `addons/<id>/` holds the add-on's `index.html` and is served at `https://etalii.net/adp-notion/<id>/`. The address depends on the folder's name alone, so it does not change when another add-on is added or removed. No add-on has the id `index`, which is the add-on index's own name.

There is no add-on yet.

The add-on index at <https://etalii.net/adp-notion> is generated from the folders found here by [scripts/build.mjs](../scripts/build.mjs); it is never written by hand. A file in this folder, such as this one, is no add-on.
