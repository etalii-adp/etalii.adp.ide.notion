# Where the files under src/fbl/ come from

They are the FBL library of the Visual Studio Code host, copied unchanged, byte for byte, from `src/core/fbl/` of [etalii-adp/etalii.adp.ide.vscode](https://github.com/etalii-adp/etalii.adp.ide.vscode), which is licensed under the Apache License 2.0, as this repository is. Do not edit a file here: a correction goes to that repository and arrives with a newer copy.

- Refresh them with `node scripts/sync-fbl.mjs [etalii.adp.ide.vscode=<git ref>]`.
- `node scripts/sync-fbl.mjs --check` compares every file with the SHA-256 below.

| File | Repository | Path | Commit | SHA-256 |
| --- | --- | --- | --- | --- |
| `documents/documentLoader.ts` | etalii.adp.ide.vscode | `src/core/fbl/documents/documentLoader.ts` | `271a92ca83548276f63b669454637491f31f9264` | `8ba9e6f3b74690e5b419d4ccc6b258add997ad92b99915c2b030221c505501b9` |
| `documents/jsonReader.ts` | etalii.adp.ide.vscode | `src/core/fbl/documents/jsonReader.ts` | `271a92ca83548276f63b669454637491f31f9264` | `57da3ef1072b689695724b5f86598629f5743af441f1c9062493ff28e632727a` |
| `documents/types.ts` | etalii.adp.ide.vscode | `src/core/fbl/documents/types.ts` | `271a92ca83548276f63b669454637491f31f9264` | `45beb81ab61bc7dd72209103808f6397337eb5dd7fb7dc19da243d1c82edf572` |
| `expressions/cel.ts` | etalii.adp.ide.vscode | `src/core/fbl/expressions/cel.ts` | `271a92ca83548276f63b669454637491f31f9264` | `7f3af8026ac5126e829de3d166c87351f045c1e969941a1aa39cc6b29c95e52d` |
| `expressions/regexMatcher.ts` | etalii.adp.ide.vscode | `src/core/fbl/expressions/regexMatcher.ts` | `271a92ca83548276f63b669454637491f31f9264` | `8677fcf19b1d64bc74397af6aa810dc7ba2aff52f45042e0c6fb0ffbd212efa8` |
| `expressions/regexSubset.ts` | etalii.adp.ide.vscode | `src/core/fbl/expressions/regexSubset.ts` | `271a92ca83548276f63b669454637491f31f9264` | `8cb00c6dcc0b0de0d29642b4bac5895e1be4f83e95629bd87ee4b033105d200f` |
| `families/json/jsonFamily.ts` | etalii.adp.ide.vscode | `src/core/fbl/families/json/jsonFamily.ts` | `271a92ca83548276f63b669454637491f31f9264` | `d62402a43ce8134d07996aaa20ce79d9bbc4b1b3ea842fef10c96c5956dd3fc4` |
| `families/lines/linesFamily.ts` | etalii.adp.ide.vscode | `src/core/fbl/families/lines/linesFamily.ts` | `271a92ca83548276f63b669454637491f31f9264` | `dbc6571640e1fe30441c67840c482ae01b6607bcb8354d34c7a80d7cb91f0b78` |
| `families/xml/xmlFamily.ts` | etalii.adp.ide.vscode | `src/core/fbl/families/xml/xmlFamily.ts` | `271a92ca83548276f63b669454637491f31f9264` | `56ce02b5f96b4b4a5367c730210dda3fde0c17ca9aac9d9bbd2c047e468bc2d5` |
| `families/yaml/flowReader.ts` | etalii.adp.ide.vscode | `src/core/fbl/families/yaml/flowReader.ts` | `271a92ca83548276f63b669454637491f31f9264` | `ee8cf9a207ae7f0ce50d75343bd8680cd930c27b62ec6c5aa1f45e0deab38e76` |
| `families/yaml/yamlFamily.ts` | etalii.adp.ide.vscode | `src/core/fbl/families/yaml/yamlFamily.ts` | `271a92ca83548276f63b669454637491f31f9264` | `44cf30f366688bb2438a6eaa07daabde86d24cdd6ac0ad8269ef766275b35ea1` |
| `families/yaml/yamlParser.ts` | etalii.adp.ide.vscode | `src/core/fbl/families/yaml/yamlParser.ts` | `271a92ca83548276f63b669454637491f31f9264` | `f7f5faa19294b9ca82086fbeb6ca94f6e00f8dd4e718388d0f3b59c73e3bd4cc` |
| `families/yaml/yamlScalars.ts` | etalii.adp.ide.vscode | `src/core/fbl/families/yaml/yamlScalars.ts` | `271a92ca83548276f63b669454637491f31f9264` | `5672410d86e05dec6118c0552b43453d5660ec948c3b5ec17f63b69111d337ca` |
| `files/fblFiles.ts` | etalii.adp.ide.vscode | `src/core/fbl/files/fblFiles.ts` | `271a92ca83548276f63b669454637491f31f9264` | `daa67355a3404e07b4837c275f538e3ad19456f467824e891565405232fa8921` |
| `files/nodeFiles.ts` | etalii.adp.ide.vscode | `src/core/fbl/files/nodeFiles.ts` | `271a92ca83548276f63b669454637491f31f9264` | `a8c06c9b2f4c0ff87975db831bcbd8482cd4e8d60907594a45a804b1c7032c27` |
| `files/paths.ts` | etalii.adp.ide.vscode | `src/core/fbl/files/paths.ts` | `271a92ca83548276f63b669454637491f31f9264` | `7c1c1f12bd298b5eb90317155010c7bb03a4323e519937911c99da40b39bc33e` |
| `finding.ts` | etalii.adp.ide.vscode | `src/core/fbl/finding.ts` | `271a92ca83548276f63b669454637491f31f9264` | `7bea79406c6f1c114ad97efaedade7f12c8d307b0a7863512d9ac964d7403d6e` |
| `history/digest.ts` | etalii.adp.ide.vscode | `src/core/fbl/history/digest.ts` | `271a92ca83548276f63b669454637491f31f9264` | `72faa9e2b4bca4b5142337990cfa3a921e157da6da4445813b1fae9d304d65d7` |
| `history/editHistory.ts` | etalii.adp.ide.vscode | `src/core/fbl/history/editHistory.ts` | `271a92ca83548276f63b669454637491f31f9264` | `99eb0f3a15f1c8afcd03ae502bb55a9d639c0c819e4c972943bfd16f6812eabe` |
| `history/openBody.ts` | etalii.adp.ide.vscode | `src/core/fbl/history/openBody.ts` | `271a92ca83548276f63b669454637491f31f9264` | `345eedad3f69e2b406dcd2e34fb3e8891b8283ebb3c9ae596ec0fbff4d404ef2` |
| `history/splicedFile.ts` | etalii.adp.ide.vscode | `src/core/fbl/history/splicedFile.ts` | `271a92ca83548276f63b669454637491f31f9264` | `d333c6bf0bfdae167aa3a7d4d686625be61ac6ddce6339c2452e5d0556d23561` |
| `index.ts` | etalii.adp.ide.vscode | `src/core/fbl/index.ts` | `271a92ca83548276f63b669454637491f31f9264` | `06c22b0d0f023e29b777ca8842b2e91356388708f3b3b55c81f26778ba224f4a` |
| `messages.ts` | etalii.adp.ide.vscode | `src/core/fbl/messages.ts` | `271a92ca83548276f63b669454637491f31f9264` | `17ae0b774605abffe236ac09e7f72710013dd7c0a11ef95dc794632796ac47d5` |
| `model.ts` | etalii.adp.ide.vscode | `src/core/fbl/model.ts` | `271a92ca83548276f63b669454637491f31f9264` | `006fa0e928dc834fe8e6d540e765fa50fb55d747562d92c93058fdd6e49b7a9a` |
| `planning/editPlanner.ts` | etalii.adp.ide.vscode | `src/core/fbl/planning/editPlanner.ts` | `271a92ca83548276f63b669454637491f31f9264` | `bce65a33a5fa9a4e6cf515212b040f684b909fb6e27dd02c73a329ed8e1e1fea` |
| `planning/modelChange.ts` | etalii.adp.ide.vscode | `src/core/fbl/planning/modelChange.ts` | `271a92ca83548276f63b669454637491f31f9264` | `1b7a8727ab047230eb8d5cd3edea886fc08687547c25e0a9d6c8bd89ce8f605e` |
| `planning/newText.ts` | etalii.adp.ide.vscode | `src/core/fbl/planning/newText.ts` | `271a92ca83548276f63b669454637491f31f9264` | `45080594cfd3a9db617d0518e7f99bb55df0254337304d0c49affbafa0df1811` |
| `planning/plan.ts` | etalii.adp.ide.vscode | `src/core/fbl/planning/plan.ts` | `271a92ca83548276f63b669454637491f31f9264` | `d70d6e5c6051b0023d3fc49bfd3eddab40793b6d726a991b73f3fc462000954b` |
| `plugins/persistencePlugin.ts` | etalii.adp.ide.vscode | `src/core/fbl/plugins/persistencePlugin.ts` | `271a92ca83548276f63b669454637491f31f9264` | `e8a6b132fae94023ff6ce9f9d0241e626495ae5ba5f25002ebf868e2c69b460f` |
| `plugins/pluginBody.ts` | etalii.adp.ide.vscode | `src/core/fbl/plugins/pluginBody.ts` | `271a92ca83548276f63b669454637491f31f9264` | `15a64f7e5b3b1a85fc894054f4c619cd97e248959d1b99dcb6e0afd44a5eb035` |
| `registration/bodyLocator.ts` | etalii.adp.ide.vscode | `src/core/fbl/registration/bodyLocator.ts` | `271a92ca83548276f63b669454637491f31f9264` | `7c971d838d282851ce991c1b23b455b2db6c06ad4bb536aa7ef8c0e5619de341` |
| `registration/legacySidecar.ts` | etalii.adp.ide.vscode | `src/core/fbl/registration/legacySidecar.ts` | `271a92ca83548276f63b669454637491f31f9264` | `73ef36b08ebbf1262e31f15edfc83e19b22ece8754a980e9815dcbd185a05090` |
| `registration/openRegistration.ts` | etalii.adp.ide.vscode | `src/core/fbl/registration/openRegistration.ts` | `271a92ca83548276f63b669454637491f31f9264` | `4d8aa91cdc4fc378dd6c2e05549f1628f4197f5a0155cff75a0ff8951389e6d7` |
| `registration/registrationDocument.ts` | etalii.adp.ide.vscode | `src/core/fbl/registration/registrationDocument.ts` | `271a92ca83548276f63b669454637491f31f9264` | `7aa29b45ac0b7a80d48a8ce4ff6067ab0c5706d5742538d5527a54900335952a` |
| `routing/folderSubject.ts` | etalii.adp.ide.vscode | `src/core/fbl/routing/folderSubject.ts` | `271a92ca83548276f63b669454637491f31f9264` | `fbc09898e78a6169f6eb8b479db748ebc76b0688388651e343136debe8175465` |
| `routing/glob.ts` | etalii.adp.ide.vscode | `src/core/fbl/routing/glob.ts` | `271a92ca83548276f63b669454637491f31f9264` | `5a66a41f4a4caaa40f711d5a42ab30fa4f3aeec59da01e691f249c37fd9d7c74` |
| `routing/markerEvaluator.ts` | etalii.adp.ide.vscode | `src/core/fbl/routing/markerEvaluator.ts` | `271a92ca83548276f63b669454637491f31f9264` | `167189cd980ed905f4cb74e5c7d9606c76deab2146da0660b3ef04576e913fce` |
| `routing/router.ts` | etalii.adp.ide.vscode | `src/core/fbl/routing/router.ts` | `271a92ca83548276f63b669454637491f31f9264` | `32f849480557a3783e1a1780f4848b9e3c14312279714bc6f1737e4b9a2419d5` |
| `routing/templateWriter.ts` | etalii.adp.ide.vscode | `src/core/fbl/routing/templateWriter.ts` | `271a92ca83548276f63b669454637491f31f9264` | `4d31b30c9bf82bdf97097b2653bc46c285c7338d4c3914972016a8a0970c1f61` |
| `rules/bodyReading.ts` | etalii.adp.ide.vscode | `src/core/fbl/rules/bodyReading.ts` | `271a92ca83548276f63b669454637491f31f9264` | `1a3f748e5530bc452f9b9a11d853fe628af8b583faee5b01509df390bc4d0347` |
| `rules/familyReader.ts` | etalii.adp.ide.vscode | `src/core/fbl/rules/familyReader.ts` | `271a92ca83548276f63b669454637491f31f9264` | `77f92fea1a8ac88f9fbc96c368fb060f6825b9470c1b4634a8bd5b21236bad7a` |
| `rules/selector.ts` | etalii.adp.ide.vscode | `src/core/fbl/rules/selector.ts` | `271a92ca83548276f63b669454637491f31f9264` | `6cff637d30c7b7902881c7c928814d3681298983e601304a6b98ebb411930ecc` |
| `rules/treeFamily.ts` | etalii.adp.ide.vscode | `src/core/fbl/rules/treeFamily.ts` | `271a92ca83548276f63b669454637491f31f9264` | `ba6322931b41a789d5779cd426cc63299d0ff8a5dd68bd6f58f5553cc50e1178` |
| `span.ts` | etalii.adp.ide.vscode | `src/core/fbl/span.ts` | `271a92ca83548276f63b669454637491f31f9264` | `c4e5b06841d21d4663034d952b536b5a5d4bf695ae3324ce0c9d52f096eb050d` |
| `splice.ts` | etalii.adp.ide.vscode | `src/core/fbl/splice.ts` | `271a92ca83548276f63b669454637491f31f9264` | `b4116e6f39aec5a06f2538df1eca40dc76e170b0c14160f243c1fafc053a80b6` |
| `text/bodyText.ts` | etalii.adp.ide.vscode | `src/core/fbl/text/bodyText.ts` | `271a92ca83548276f63b669454637491f31f9264` | `81f7286f27f48f5e68b2c5edc20ee53a3815df05796da80ff79ae0e41031f117` |
| `text/utf8.ts` | etalii.adp.ide.vscode | `src/core/fbl/text/utf8.ts` | `271a92ca83548276f63b669454637491f31f9264` | `2e9079389623f259c9011f9e669e9923ea43217fc4015aff466a8f2ad8db95a4` |
