# Private tattoo workspace

Tinta is one tattoo artist's private workspace. The artist chooses their studio name. Its visual direction is dark, editorial and restrained: charcoal, warm ivory, muted terracotta, serif display headings and artwork as the focal point.

## Audit and changes

The previous interface framed unrelated information equally. Repeated section cards, nested appointment cards, boxed search forms, artwork captions inside containers and framed calendar summaries created a dashboard appearance.

The redesign removes outer frames from client lists, search groups, settings sections, appointment form sections, appointment metadata, notes and payments. Design images sit on quiet mats with captions below. The calendar keeps its useful time grid and gives appointment objects a status edge and subtle background. Status labels use a small dot and text rather than a pill.

Use composition, type and space before a frame. Keep visible control boundaries for inputs, focus indicators and the primary action. A dialog or an independent interactive object can retain a surface; a simple text group cannot.

## Tokens and primitives

`studio-theme.css` owns the palette. `workspace.css` owns the editorial layout primitives and shared rhythm.

| Token | Purpose |
| --- | --- |
| `--bg`, `--surface-soft`, `--text`, `--muted`, `--accent`, `--action` | Charcoal surfaces, ivory text and restrained terracotta actions |
| `--space-small`: 12px | Caption and heading relationships |
| `--space-group`: 24px | Rows and related objects |
| `--space-section`: 32–56px | Separate sections and columns |
| `--rule`: translucent white | Quiet horizontal division |
| `--type-display`: 38–54px | Page titles |
| `--radius`, `--radius-small`: 2px, 3px | Objects and controls; sections have no radius |

| Primitive | Use |
| --- | --- |
| `workspace-stack` | Vertical rhythm without an enclosing card |
| `workspace-split` | Unequal editorial columns; artwork can lead; stacks on smaller screens |
| `workspace-section` | An open group, optionally separated by a horizontal rule |
| `section-intro` | Serif section title with concise supporting text |
| `data-row` | List or history row with a bottom divider |
| `artwork-object` | Image first, open caption below; selection indicated on the image |

Reuse these primitives rather than introducing a new card class for each page. Existing component classes retain functional layout responsibilities. Avoid a card inside another card, an outer panel around a whole page or matching boxes for metadata and artwork.

## Appointment interactions

`appointment-workflows.css` reuses the shared spacing, palette and rule tokens. The record header groups date, status, contact and actions before the artwork. Focused rescheduling opens between horizontal rules; errors use a short accent edge and visible focus rather than a surrounding card. Form errors are linked to their fields and retain the artist's entered values.

Date and time controls stay consistent across creation and editing. References are optional, and supplementary price/deposit fields use a disclosure that opens when needed for editing or error correction. The payment record leads with price, received amount and remaining balance; deposit information is secondary. Cancelled/no-show records show a neutral signed difference between price and received amounts, without implying a cancellation or refund policy.

Adding a client or importing artwork from a booking stores a bounded, short-lived draft in the current tab's session storage. Return URLs carry an opaque token, not notes or payment values. Newly created records are selected on return, and the temporary snapshot is consumed.

## Measured reduction

At 1440px, the same seven populated routes were audited before and after using computed styles. The measure counts rendered elements at least 120px wide and 45px high with a visible border on all four sides; input controls are outside the count. The calendar's primary action link is included consistently in both runs.

| View | Before | After |
| --- | ---: | ---: |
| Weekly calendar | 10 | 1 |
| Clients | 2 | 0 |
| Designs | 4 | 0 |
| New appointment | 8 | 0 |
| Settings | 4 | 0 |
| Appointment details | 6 | 0 |
| Client details | 2 | 0 |
| Total | 36 | 1 |

This is a 97% reduction in fully outlined elements under this measure. It measures borders, not all visible surfaces: artwork mats, calendar event fills, form controls and accessible focus outlines remain intentional.

Visual verification also covers mobile calendar and artwork layouts, the asymmetric appointment composition, settings column alignment and open form sections. Browser workflow tests verify that the layout changes preserve client, design, appointment and payment actions.

## Preview

These screenshots use fictitious demo records and sample artwork.

![Open artwork library](previews/designs.png)

![Artwork-led appointment details](previews/appointment.png)

![Weekly calendar with open summary and toolbar](previews/calendar.png)
