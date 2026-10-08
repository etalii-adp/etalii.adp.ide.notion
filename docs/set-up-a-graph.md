# Set up a graph

A Notion add-on shows what one Notion database holds. That database is the graph's store: its rows are the graph, and there is no file and no second copy. Setting a graph up is giving the add-on a database and a page to show it on. It takes a few minutes and changes nothing of the add-on: one published add-on serves any number of graphs, and the page that embeds it says which store it shows.

The steps below use the Gartner hype cycle graph, whose address is `https://etalii.net/adp-notion/gartner-hype-cycle-graph/`. Another add-on is set up the same way with its own address. The add-on shows the same steps in short when its address names no database.

The add-on reaches Notion through a service. Until the deployed service exists, the steps work with a local build of the add-on and the local service, and the address is the local one; see [service.md](service.md).

## The steps

1. **Create a database.** In Notion, create a new database, as a page of its own. It becomes the store of one graph, so give each graph its own. Name it after the graph, such as `Coal technologies - Data`. Leave it as Notion made it: the add-on adds the properties it needs in step 6.
2. **Share the database with the connection.** Open the menu of the database, choose Connections, and add the connection of the add-on. Without this the add-on is told that the database does not exist.
3. **Copy the id of the database.** Open the database as a full page. Its id is the 32 characters of its Notion address before `?v=`: in `https://app.notion.com/p/3f2be2fd05b680f5bfe1d89398eabb4e?v=...` it is `3f2be2fd05b680f5bfe1d89398eabb4e`.
4. **Create the page with the embed block.** On the Notion page that is to show the graph, add an embed block and give it the address of the add-on followed by `?store=` and the id:

   ```text
   https://etalii.net/adp-notion/gartner-hype-cycle-graph/?store=3f2be2fd05b680f5bfe1d89398eabb4e
   ```

   Add `&theme=light` or `&theme=dark` to fix the appearance; without it the add-on follows the browser. Make the block as wide and as high as the graph needs.
5. **Grant access once.** Open the page. The add-on invites you to connect: the button opens a window of Notion's in which you grant the add-on access. One grant serves every Notion add-on in that browser. Where the browser opens no window from an embedded page, use the link beside the button, which opens the add-on in a tab of its own.
6. **Let the add-on prepare the database.** A new database lacks the properties of a store, so the add-on says what is missing and offers to prepare it. Preparing renames the title property to `id` and adds `Kind`, `Order` and one property for each key of the tool type's documents. It changes no property that exists with the right type, removes none and touches no row.

The page now shows an empty graph that can be edited. Every edit is stored in the database as it is made; there is nothing to save.

## What the page can show

The page is in one state at a time.

| State | What it means | What to do |
| --- | --- | --- |
| `loading` | The add-on is reading the store. Every row is read before anything is drawn | Wait. A store of some hundreds of rows takes a few seconds |
| `setup` | The address has no `store`, or its value is no database id | Give the embed block the address of step 4 |
| `connect` | No access is kept in this browser, or Notion no longer takes it | Grant access, as in step 5 |
| `unshared` | Access is granted, and Notion says the database does not exist for it | Share the database with the connection, as in step 2, or grant access again and include the database |
| `unprepared` | The database lacks a property of a store, holds one with another type, or has more than one data source | Let the add-on prepare it, as in step 6. A property with another type is left alone: rename or remove it in Notion and prepare again. A database with several data sources cannot be a store |
| `ready` | The store is read and can be written | Edit the graph |
| `read-only` | The store is read, and Notion refuses your writes. Nothing says so before a write, so the page is `ready` until Notion refuses the first one, which changes nothing | Ask for the right to edit the database, then open the page again |
| `unreadable` | The rows cannot be read as a document at all. The page shows an empty graph and offers no editing | Look at the findings the page lists, and repair the rows in the database's own table |

A row that cannot be read is no state of its own: it is listed as a finding, and the rest of the graph is drawn. The same goes for a row whose `Kind` is empty or names no kind.

You may edit the database's table by hand. A property the add-on does not know is left alone, a row in the trash is no row, and the order of the rows of one kind is their `Order`.

## Filling a store from a file

[scripts/store.mjs](../scripts/store.mjs) moves a document between a file and a store, with the code the add-on reads and writes a store with. Run it from the root of a checkout of this repository:

```text
node scripts/store.mjs put <database> <file> [--replace]
node scripts/store.mjs take <database> <file> [--force]
```

`<database>` is the id of step 3 or the Notion address of the database, and `<file>` is a document of the tool type, here a `.ghg`. The database must be shared with the connection the token belongs to, as in step 2.

| What | How |
| --- | --- |
| The Notion token | Read from the environment variable `NOTION_TOKEN`, and from nowhere else |
| The add-on | `--addon <id>`, the name of its folder under `addons/`. With one add-on in the repository it may be left out |
| The service | `--service <address>`. By default the local service, `http://localhost:8787`, which must be running; see [service.md](service.md). The service only forwards a call with the token it is given, so the token of an internal integration works as well as one a grant of access gave |

`put` prepares the database, as step 6 does, and then stores the document as rows. It refuses a database that has rows unless `--replace` is given, which moves those rows to the trash first. It reports what a store cannot hold and does not keep: comments, keys the binding does not read, entries that are not a mapping, and the id of a reference that names nothing. Where Notion cannot hold a value of the document in its property, such as an option with a comma, it says which and puts nothing in.

`take` writes the document the rows give, through the binding, and overwrites `<file>` only with `--force`. A document that was put in and taken out reads the same in the other hosts; its bytes may differ, as its comments are gone and a number may be written another way.

The exit code is 0 when the whole document is stored or written. With 1 it is not, and the store or the file is not to be relied on: a row that `take` could not read is reported and is not in the file. With 2 the command line or the environment was not as above. Notion allows about three requests a second, so a document of 500 entries takes about three minutes to put in.

The rules a store follows are in the [store contract](https://github.com/etalii-adp/etalii.adp/blob/develop/specs/012-notion-hype-cycle-addon/contracts/store.md), and those of the page in the [add-on address contract](https://github.com/etalii-adp/etalii.adp/blob/develop/specs/012-notion-hype-cycle-addon/contracts/addon-address.md).
