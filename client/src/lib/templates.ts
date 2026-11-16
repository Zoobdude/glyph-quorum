export interface Template { id: string; name: string; title: string; content: string }

export const TEMPLATES: Template[] = [
  {
    id: 'article', name: 'Article', title: 'Untitled article',
    content: `#set page(paper: "a4", margin: 2.5cm, numbering: "1")
#set text(size: 11pt)
#set par(justify: true)
#set heading(numbering: "1.1")

#align(center)[
  #text(size: 20pt, weight: "bold")[Article Title]

  Author Name \\
  #datetime.today().display("[month repr:long] [day], [year]")
]

#v(1em)

*Abstract.* #lorem(50)

= Introduction
#lorem(80)

= Method
#lorem(60)

$ E = m c^2 $

= Conclusion
#lorem(40)
`,
  },
  {
    id: 'report', name: 'Report', title: 'Untitled report',
    content: `#set page(paper: "a4", margin: 2.5cm, numbering: "1")
#set text(size: 11pt)
#set heading(numbering: "1.")

#v(4cm)
#text(size: 28pt, weight: "bold")[Report Title]

#text(size: 14pt, fill: gray)[Subtitle or project name]

#v(1cm)
Prepared by Author Name \\
#datetime.today().display("[month repr:long] [year]")

#pagebreak()
#outline()
#pagebreak()

= Summary
#lorem(60)

= Findings
== First finding
#lorem(50)

#table(
  columns: (1fr, auto, auto),
  table.header[*Item*][*Before*][*After*],
  [Throughput], [120], [185],
  [Error rate], [4.1%], [1.3%],
)

== Second finding
#lorem(50)

= Recommendations
+ First recommendation
+ Second recommendation
+ Third recommendation
`,
  },
  {
    id: 'letter', name: 'Letter', title: 'Untitled letter',
    content: `#set page(paper: "a4", margin: 2.5cm)
#set text(size: 11pt)

#align(right)[
  Your Name \\
  Street Address \\
  City, Postcode

  #datetime.today().display("[day] [month repr:long] [year]")
]

Recipient Name \\
Organisation \\
Street Address

#v(1em)
Dear Recipient,

#lorem(60)

#lorem(40)

Yours sincerely,

#v(2em)
Your Name
`,
  },
  {
    id: 'notes', name: 'Meeting notes', title: 'Meeting notes',
    content: `#set page(paper: "a4", margin: 2cm)
#set text(size: 11pt)

= Meeting notes
#datetime.today().display("[weekday], [day] [month repr:long] [year]")

*Attendees:* Name, Name, Name

== Agenda
+ First topic
+ Second topic

== Discussion
- Point raised
- Point raised

== Action items
- [ ] Owner — task, due date
- [ ] Owner — task, due date
`,
  },
]
