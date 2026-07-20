---
mindmap:
  nodes:
    ^924531: { width: 480.62734375 }
    ^zhk7fz: { width: 195.12295226235875 }
---
# Tool notes

## new features in my mind to be implemented
- show links and relations ^924531
  - two different association types
    - link
      - link to some external resource
        - it can be
          - a web url
          - file path
          - folder
    - relation
      - relation between lower level nodes in the same document
        - if it is in the same document it an arrow can be shown(this can be disabled)
          - there can me multiple relations from the same start to different end nodes
      - relation to a node in different document
        - similar to same document
          - user can select the target .md file with an autocomplete combobox and after the file is selected its contents will be retrieved to be added as a relation
  - how to show
    - similar to current Edit Link view
      - top part
        - There will be radio button at top
          - to identify the association type
          - values
            - document relation
              - selected by default
            - link
      - below part
        - if
          - document relation is selected
            - it shows two auto complete combobox
              - autocomplete to select the document(.md file)
              - autocomplete to select the node inside the selected document from the previous combobox
          - link is selected
            - current link is implementation is correct, it can be url, file, folder etc.
- I want to add some badges to be available to show the status of the node. They will be images to show them.  Some of the most required ones are  Completed, Started, Blocked, Red Flag, Green Flag, Ready to work on. Decide to use what is best. use approaches without any licensing issues. if needed create these yourself.
## problems to fix → [youtube](www.youtube.com) → [docu](/Users/burakucbinli/projects/obsidian/test/metadata.test.ts)
- bugs ^zhk7fz
  Links: [youtube](www.youtube.com)
  - no bug for now
- UX
  - if scrolled horizontally or vertically node edit box remains in the beginning position
## www.youtube.com link is added but it does not go to the app, just opens a new note with that name
