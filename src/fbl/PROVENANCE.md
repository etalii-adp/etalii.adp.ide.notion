# Where the files under src/fbl/ come from

They are the FBL library of the Visual Studio Code host, copied unchanged, byte for byte, from `src/core/fbl/` of [etalii-adp/etalii.adp.ide.vscode](https://github.com/etalii-adp/etalii.adp.ide.vscode), which is licensed under the Apache License 2.0, as this repository is. Do not edit a file here: a correction goes to that repository and arrives with a newer copy.

- Refresh them with `node scripts/sync-fbl.mjs [etalii.adp.ide.vscode=<git ref>]`.
- `node scripts/sync-fbl.mjs --check` compares every file with the SHA-256 below.

| File | Repository | Path | Commit | SHA-256 |
| --- | --- | --- | --- | --- |
| `documents/documentLoader.ts` | etalii.adp.ide.vscode | `src/core/fbl/documents/documentLoader.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `e21f64cdfe8f31cb5bd98a6277d2e4dd0b467deadf42bcdf65739402ccc0e72c` |
| `documents/jsonReader.ts` | etalii.adp.ide.vscode | `src/core/fbl/documents/jsonReader.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `57da3ef1072b689695724b5f86598629f5743af441f1c9062493ff28e632727a` |
| `documents/types.ts` | etalii.adp.ide.vscode | `src/core/fbl/documents/types.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `9cdd1dddada69718341c8c0587e03ffc4105fd1dab6094e4ab8449f6c2566cd9` |
| `expressions/cel.ts` | etalii.adp.ide.vscode | `src/core/fbl/expressions/cel.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `e7b0b8f407ffdb90771032e1ce71526c0e5877b767b94b4e6266ce39702e2471` |
| `expressions/regexMatcher.ts` | etalii.adp.ide.vscode | `src/core/fbl/expressions/regexMatcher.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `8677fcf19b1d64bc74397af6aa810dc7ba2aff52f45042e0c6fb0ffbd212efa8` |
| `expressions/regexSubset.ts` | etalii.adp.ide.vscode | `src/core/fbl/expressions/regexSubset.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `8cb00c6dcc0b0de0d29642b4bac5895e1be4f83e95629bd87ee4b033105d200f` |
| `families/json/jsonFamily.ts` | etalii.adp.ide.vscode | `src/core/fbl/families/json/jsonFamily.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `a426b4c03ce0c8b79b6e31b3abe02809382158228e14c565292dd2168634df00` |
| `families/lines/linesFamily.ts` | etalii.adp.ide.vscode | `src/core/fbl/families/lines/linesFamily.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `dbc6571640e1fe30441c67840c482ae01b6607bcb8354d34c7a80d7cb91f0b78` |
| `families/xml/xmlFamily.ts` | etalii.adp.ide.vscode | `src/core/fbl/families/xml/xmlFamily.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `e8268793de0c08e524c715ccde76fcf0b8b531fca4de008ac1ef9c4a7abc42a2` |
| `families/yaml/flowReader.ts` | etalii.adp.ide.vscode | `src/core/fbl/families/yaml/flowReader.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `f5e74039493990ce0821b59be7b9612527b9e54dd9725c242e59ba885f443f58` |
| `families/yaml/yamlFamily.ts` | etalii.adp.ide.vscode | `src/core/fbl/families/yaml/yamlFamily.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `fba4c0d97b82a17ef9fc827f3efde1b7f9f9938074385ff982467c1c177b213a` |
| `families/yaml/yamlParser.ts` | etalii.adp.ide.vscode | `src/core/fbl/families/yaml/yamlParser.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `3051ea1abf5f112bce6478694f69684c1600535a22568821edf8da2c111b5820` |
| `families/yaml/yamlScalars.ts` | etalii.adp.ide.vscode | `src/core/fbl/families/yaml/yamlScalars.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `7871ecfe0c291709f3d934a154fe7ea3ddab3683094e77c78594bb1a31493ffe` |
| `files/fblFiles.ts` | etalii.adp.ide.vscode | `src/core/fbl/files/fblFiles.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `daa67355a3404e07b4837c275f538e3ad19456f467824e891565405232fa8921` |
| `files/nodeFiles.ts` | etalii.adp.ide.vscode | `src/core/fbl/files/nodeFiles.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `a8c06c9b2f4c0ff87975db831bcbd8482cd4e8d60907594a45a804b1c7032c27` |
| `files/paths.ts` | etalii.adp.ide.vscode | `src/core/fbl/files/paths.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `7c1c1f12bd298b5eb90317155010c7bb03a4323e519937911c99da40b39bc33e` |
| `finding.ts` | etalii.adp.ide.vscode | `src/core/fbl/finding.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `619764ecf5db4c244e6ad451e1c6af2d7f79dbb513e3dbf14cae6bd7746b79b7` |
| `history/digest.ts` | etalii.adp.ide.vscode | `src/core/fbl/history/digest.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `72faa9e2b4bca4b5142337990cfa3a921e157da6da4445813b1fae9d304d65d7` |
| `history/editHistory.ts` | etalii.adp.ide.vscode | `src/core/fbl/history/editHistory.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `99eb0f3a15f1c8afcd03ae502bb55a9d639c0c819e4c972943bfd16f6812eabe` |
| `history/openBody.ts` | etalii.adp.ide.vscode | `src/core/fbl/history/openBody.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `fc0eca1f46d56ee8990b40f16976004f6326b4910c47771f25350039cefd3235` |
| `history/splicedFile.ts` | etalii.adp.ide.vscode | `src/core/fbl/history/splicedFile.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `d333c6bf0bfdae167aa3a7d4d686625be61ac6ddce6339c2452e5d0556d23561` |
| `index.ts` | etalii.adp.ide.vscode | `src/core/fbl/index.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `5fad89afbb3efc68b88b74bdf6459166d4ca60a36be63e7b197a16fa6ebefe41` |
| `messages.ts` | etalii.adp.ide.vscode | `src/core/fbl/messages.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `b20b0cff4fc1c6a04d541554d376081a1c8fb5dd0d2dddf887f676e4615f2aa1` |
| `model.ts` | etalii.adp.ide.vscode | `src/core/fbl/model.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `3fb35e768249cf5d311880befe7d690fa656381cb3ab79e6479ad1714a11d393` |
| `planning/editPlanner.ts` | etalii.adp.ide.vscode | `src/core/fbl/planning/editPlanner.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `a4aa3db8a0155143378b77ab67a5ba3ad1b01feb808724fa30141b922eca365e` |
| `planning/modelChange.ts` | etalii.adp.ide.vscode | `src/core/fbl/planning/modelChange.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `d90f05da42a6977e87240a905e61dff0e90ef2271b4156de58b1e39fcf39a6f7` |
| `planning/newText.ts` | etalii.adp.ide.vscode | `src/core/fbl/planning/newText.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `82048c2b794a570d101cf85141d213a1e6db668401b0135fad13def87daa5ae8` |
| `planning/plan.ts` | etalii.adp.ide.vscode | `src/core/fbl/planning/plan.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `19edb88dd28103bbe38dbc98f881d4f42893d073f4b5d29720442c1c2386a076` |
| `plugins/persistencePlugin.ts` | etalii.adp.ide.vscode | `src/core/fbl/plugins/persistencePlugin.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `f53e97fbd9efc7d46909c709df8421d815e341df1a0e313e172ea9c674f51019` |
| `plugins/pluginBody.ts` | etalii.adp.ide.vscode | `src/core/fbl/plugins/pluginBody.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `8a3ab4b89fbf26235834315aa4568f0e0cf79187e2be045eb8274478e019a150` |
| `registration/bodyLocator.ts` | etalii.adp.ide.vscode | `src/core/fbl/registration/bodyLocator.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `b3642924957719e8e31d25179d9626fb2bb5194d08dba33050735cfe19629828` |
| `registration/legacySidecar.ts` | etalii.adp.ide.vscode | `src/core/fbl/registration/legacySidecar.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `73ef36b08ebbf1262e31f15edfc83e19b22ece8754a980e9815dcbd185a05090` |
| `registration/openRegistration.ts` | etalii.adp.ide.vscode | `src/core/fbl/registration/openRegistration.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `868d8936029460ca2e0f2379c60b87d4f01feb2e86fe485bb84b36d0fc08c7a9` |
| `registration/registrationDocument.ts` | etalii.adp.ide.vscode | `src/core/fbl/registration/registrationDocument.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `7aa29b45ac0b7a80d48a8ce4ff6067ab0c5706d5742538d5527a54900335952a` |
| `routing/folderSubject.ts` | etalii.adp.ide.vscode | `src/core/fbl/routing/folderSubject.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `fbc09898e78a6169f6eb8b479db748ebc76b0688388651e343136debe8175465` |
| `routing/glob.ts` | etalii.adp.ide.vscode | `src/core/fbl/routing/glob.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `5a66a41f4a4caaa40f711d5a42ab30fa4f3aeec59da01e691f249c37fd9d7c74` |
| `routing/markerEvaluator.ts` | etalii.adp.ide.vscode | `src/core/fbl/routing/markerEvaluator.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `167189cd980ed905f4cb74e5c7d9606c76deab2146da0660b3ef04576e913fce` |
| `routing/router.ts` | etalii.adp.ide.vscode | `src/core/fbl/routing/router.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `32f849480557a3783e1a1780f4848b9e3c14312279714bc6f1737e4b9a2419d5` |
| `routing/templateWriter.ts` | etalii.adp.ide.vscode | `src/core/fbl/routing/templateWriter.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `4d31b30c9bf82bdf97097b2653bc46c285c7338d4c3914972016a8a0970c1f61` |
| `rules/bodyReading.ts` | etalii.adp.ide.vscode | `src/core/fbl/rules/bodyReading.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `56e4058c83f4dd7a517b57240ff6326023bb03a97103b220871b6c9201cb9fff` |
| `rules/familyReader.ts` | etalii.adp.ide.vscode | `src/core/fbl/rules/familyReader.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `54d3d76374f146d2504afec1595ebb7bff156294b7e3c7947ba63fea10bb65b0` |
| `rules/selector.ts` | etalii.adp.ide.vscode | `src/core/fbl/rules/selector.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `6cff637d30c7b7902881c7c928814d3681298983e601304a6b98ebb411930ecc` |
| `rules/treeFamily.ts` | etalii.adp.ide.vscode | `src/core/fbl/rules/treeFamily.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `a4e1da266f3b78d59b652ec8decf8eb8afeb6df8c823c58e8d878b49408f0d43` |
| `rules/typedValue.ts` | etalii.adp.ide.vscode | `src/core/fbl/rules/typedValue.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `d1ac957f162ce640f62a2506088de81432a2b67eead24f23a35ffb3aae3603fc` |
| `span.ts` | etalii.adp.ide.vscode | `src/core/fbl/span.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `c4e5b06841d21d4663034d952b536b5a5d4bf695ae3324ce0c9d52f096eb050d` |
| `splice.ts` | etalii.adp.ide.vscode | `src/core/fbl/splice.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `b4116e6f39aec5a06f2538df1eca40dc76e170b0c14160f243c1fafc053a80b6` |
| `text/bodyText.ts` | etalii.adp.ide.vscode | `src/core/fbl/text/bodyText.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `81f7286f27f48f5e68b2c5edc20ee53a3815df05796da80ff79ae0e41031f117` |
| `text/utf8.ts` | etalii.adp.ide.vscode | `src/core/fbl/text/utf8.ts` | `97e403d4a6f3fc858c6eacd132605627f6b7bbca` | `2e9079389623f259c9011f9e669e9923ea43217fc4015aff466a8f2ad8db95a4` |
