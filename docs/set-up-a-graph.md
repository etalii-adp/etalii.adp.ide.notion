# Set up a graph

A Notion add-on shows what one Notion database holds. That database is the graph's store: its rows are the graph, and there is no file and no second copy. Setting a graph up is giving the add-on a database and a page to show it on. It takes a few minutes and changes nothing of the add-on: one published add-on serves any number of graphs, and the page that embeds it says which store it shows.

The steps below use the Gartner hype cycle graph, whose address is `https://etalii.net/adp-notion/gartner-hype-cycle-graph/`. Another add-on is set up the same way with its own address. The add-on shows the same steps in short when its address names no database.

The add-on reaches Notion through a service. Until the deployed service exists, the steps work with a local build of the add-on and the local service, and the address is the local one; see [service.md](service.md).

## The steps

1. **Create a database.** In Notion, create a new database on the page that is to hold the graph. It becomes the store of one graph, so give each graph its own. Name it after the graph, such as `Coal technologies - Data`. Leave it as Notion made it, or take a database you have: the add-on asks about its properties in step 4.
2. **Add the embed block.** On that page, or on a page directly under it, add an embed block and give it the address of the add-on alone:

   ```text
   https://etalii.net/adp-notion/gartner-hype-cycle-graph/
   ```

   Add `?theme=light` or `?theme=dark` to fix the appearance; without it the add-on follows the browser. Make the block as wide and as high as the graph needs. The block shows these steps in short, and the control `Choose a database`.
3. **Choose the database in the add-on.** Use `Choose a database`. The first time, a window of Notion's opens in which you grant the add-on access: include the database and the page it is on. One grant serves every Notion add-on in that browser. Where no window opens, as in the Notion desktop app, use the link the add-on shows, which opens the sign-in in your browser. The add-on then lists the databases your grant reaches, 25 at a time, each with its title and whether it is on a page or at the top of the workspace; the field above the list finds one by a part of its name. Choose yours.
4. **Agree to the properties.** A database that is no store yet lacks properties, and the add-on lists each one it would get. Where the database already has a property of the type that is needed under another name, you choose per property between a new one and that existing one, which is then given the name that is needed. Nothing of the database is changed until you use `Prepare this database`. Preparing renames the title property to `id`, renames what you chose, and adds `Kind`, `Order` and the other properties that are still missing, in one step. It changes no property that exists with the right name and type, removes none and touches no row. It then hides the properties that hold internal information in the views of the database; see "What a view of the database shows" below.
5. **The embed block is given its database.** The add-on looks for its embed block that names no database, on the page that holds the database and on the pages directly under it. Where it finds exactly one, it sets that block's address to name the database, and the diagram is shown. Where it finds none or several, where the database is on no page, or where Notion does not let it look, the diagram is shown all the same, and above it the address with its `store`, with a control that copies it: put that address in the embed block yourself, or the block shows these steps again the next time its page is opened.

The page now shows an empty graph that can be edited. Every edit is stored in the database as it is made; there is nothing to save.

### Naming the database by hand

The address of a graph is the address of the add-on followed by `?store=` and the id of the database. The id is the 32 characters of the database's Notion address before `?v=`: in `https://app.notion.com/p/3f2be2fd05b680f5bfe1d89398eabb4e?v=...` it is `3f2be2fd05b680f5bfe1d89398eabb4e`.

```text
https://etalii.net/adp-notion/gartner-hype-cycle-graph/?store=3f2be2fd05b680f5bfe1d89398eabb4e
```

An embed block with that address needs no choosing: the page asks for access and, where the database is no store yet, asks about its properties as in step 4. A database is shared with the add-on either in the grant of access or, afterwards, under Connections in the menu of the database.

### What a view of the database shows

A reader of the database's table is to see what the graph is about. So preparing hides, in every view of the database that shows properties, the properties that are needed only to draw or to keep the graph: the order of the rows, a place on an axis that is no time axis, a size, what a handle of a shape sets, and where an end of a relation is attached. Which ones those are is found from the tool type's specification. For the Gartner hype cycle graph they are `Order`, `row`, `width`, `height`, `peak-end`, `trough-end`, `slope-end`, `from-phase`, `from-edge`, `from-at`, `to-phase`, `to-edge` and `to-at`. The properties stay in the database and can be shown again in Notion; a view that is added later shows what Notion makes it show. A note's `at` is its date on the time axis, so the rule leaves it shown; hide it by hand where it is not wanted.

## What the page can show

The page is in one state at a time.

| State | What it means | What to do |
| --- | --- | --- |
| `loading` | The add-on is reading the store. Every row is read before anything is drawn | Wait. A store of some hundreds of rows takes a few seconds |
| `setup` | The address has no `store`, or its value is no database id | Choose a database, as in step 3, or give the embed block an address that names one |
| `connect` | The address names a database, and no access is kept in this browser, or Notion no longer takes it | Grant access with the button the page shows |
| `unshared` | Access is granted, and Notion says the database does not exist for it | Share the database with the connection, under Connections in the menu of the database, or grant access again and include the database |
| `unprepared` | The database lacks a property of a store, holds one with another type, or has more than one data source | Let the add-on prepare it, as in step 4. A property with another type is left alone: rename or remove it in Notion and prepare again. A database with several data sources cannot be a store |
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

`<database>` is the id of the database or its Notion address, and `<file>` is a document of the tool type, here a `.ghg`. The database must be shared with the connection the token belongs to.

| What | How |
| --- | --- |
| The Notion token | Read from the environment variable `NOTION_TOKEN`, and from nowhere else |
| The add-on | `--addon <id>`, the name of its folder under `addons/`. With one add-on in the repository it may be left out |
| The service | `--service <address>`. By default the local service, `http://localhost:8787`, which must be running; see [service.md](service.md). The service only forwards a call with the token it is given, so the token of an internal integration works as well as one a grant of access gave |

`put` prepares the database, adding every missing property as a new one, hides the internal properties in its views as step 4 does, and then stores the document as rows. Where Notion does not let it change a view, it says so and stores the document all the same. It refuses a database that has rows unless `--replace` is given, which moves those rows to the trash first. It reports what a store cannot hold and does not keep: comments, keys the binding does not read, entries that are not a mapping, and the id of a reference that names nothing. Where Notion cannot hold a value of the document in its property, such as an option with a comma, it says which and puts nothing in.

`take` writes the document the rows give, through the binding, and overwrites `<file>` only with `--force`. A document that was put in and taken out reads the same in the other hosts; its bytes may differ, as its comments are gone and a number may be written another way.

The exit code is 0 when the whole document is stored or written. With 1 it is not, and the store or the file is not to be relied on: a row that `take` could not read is reported and is not in the file. With 2 the command line or the environment was not as above. Notion allows about three requests a second, so a document of 500 entries takes about three minutes to put in.

The rules a store follows are in the [store contract](https://github.com/etalii-adp/etalii.adp/blob/develop/specs/012-notion-hype-cycle-addon/contracts/store.md), and those of the page in the [add-on address contract](https://github.com/etalii-adp/etalii.adp/blob/develop/specs/012-notion-hype-cycle-addon/contracts/addon-address.md).
