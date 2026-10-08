# Where the specification and the binding of this Notion add-on come from

They are copied unchanged, byte for byte, from repositories of [etalii-adp](https://github.com/etalii-adp), which are licensed under the Apache License 2.0, as this repository is: the DISL specification of the tool type from `etalii.adp`, and the FBL binding from the repository the specification's `persistence.binding` names. Do not edit either here: a correction goes to its repository and arrives with a newer copy.

- Refresh them with `node scripts/sync-specifications.mjs [<repository>=<git ref> ...]`.
- `node scripts/sync-specifications.mjs --check` compares both with the SHA-256 below.

| File | Repository | Path | Commit | SHA-256 |
| --- | --- | --- | --- | --- |
| `gartner-hype-cycle-graph.dis` | etalii.adp | `definitions/diagrams/gartner-hype-cycle-graph.dis` | `350ec4cf01f89cf13b5e14b9af16a7ac066d08fd` | `fab0bbdf6a57db82402214f114e08bafb7a082569f42681ecd44a5442d2683e6` |
| `gartner-hype-cycle-graph.fbl` | etalii.adp.ide.standalone | `src/diagrams/gartner-hype-cycle-graph/backend/EtAlii.Adp.Diagram.GartnerHypeCycleGraph/gartner-hype-cycle-graph.fbl` | `70ac0263e86a189aee8a8ee690c56e80a8c99aa5` | `69c9f444ddf13e98f62a22b1e7bc86e7b08be2c60629df27f7226681c750b46e` |
