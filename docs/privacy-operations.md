# Privacy operations

This is an operator working guide, not a compliance certificate. Complete the
review fields and verify the deployed system before publishing factual privacy
claims. The application, hosting configuration and agreements must agree with
the privacy notice. Requirements below are legal obligations where applicable;
suggested review frequencies and implementation examples are operational choices.

## Deployment facts to complete

| Review field | Verified value / evidence |
| --- | --- |
| Operator legal name, legal form, postal address and establishment country | **REVIEW REQUIRED** |
| Operator privacy email and person monitoring it | **REVIEW REQUIRED** |
| Registration/tax details for the applicable legal notice | **REVIEW REQUIRED** |
| Production origin and responsible deployment owner | **REVIEW REQUIRED** |
| Physical server country, storage locations and permitted administrator locations | **REVIEW REQUIRED** |
| Backup provider, countries, access locations and expiry schedule | **REVIEW REQUIRED** |
| EU representative / DPO requirement and assessment | **REVIEW REQUIRED; do not invent an appointment** |
| Current notice, artist agreement and provider agreement versions | **REVIEW REQUIRED** |
| Optional diagnostics consent/default-off implementation and verification date | Prepared and locally verified 2026-10-05; **production deployment pending** |
| Retention scheduler, last successful run and alert owner | Startup + 15-minute runtime maintenance prepared and locally verified; **production verification and alert owner pending** |

GDPR territorial scope depends on establishment and relevant EU offerings or
monitoring, not simply where a server stands. An ongoing non-EU operator offering
services to EU individuals must assess the Article 27 representative requirement.
[GDPR Articles 3 and 27](https://www.boe.es/buscar/doc.php?id=DOUE-L-2016-80807).
For Spain, review LSSI Articles 2–4 before applying Article 10's operator notice;
Spanish technology alone does not establish the operator in Spain.
[LSSI](https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758).

## Roles and lawful-basis review

The operator is controller for artist account administration and its own
security/support purposes. Each independent artist is controller for their
clients' appointments, contact details, payment records and identifiable artwork;
the operator hosts/processes those records on the artist's instructions. Shared
infrastructure does not itself make the artists joint controllers. Using client
records for an operator's separate purposes changes the role for that operation
and requires a separate assessment.
[EDPB 07/2020, paragraphs 71 and 78–81](https://www.edpb.europa.eu/system/files/documents/2023-10/EDPB_guidelines_202007_controllerprocessor_final_en.pdf).

Record a lawful basis for each operator purpose. Contractual necessity may cover
necessary services to an artist who is the contracting individual; it does not
automatically cover every user or improvement activity. Where relying on
legitimate interests, retain a short LIA: precise interest, necessity,
less intrusive alternatives, expected effects on people, balancing outcome,
safeguards, objection procedure, approver and review date. Privacy-notice
acknowledgement is not consent. Artists determine their own client bases and
provide client information; the processor agreement records instructions.
[AEPD lawful bases](https://www.aepd.es/preguntas-frecuentes/2-tus-obligaciones-como-responsable-del-tratamiento/5-bases-legitimadoras-del-tratamiento/FAQ-0214-cuales-son-las-bases-de-legitimacion-para-el-tratamiento-de-datos).

Health information such as allergies, medication or conditions needs an Article 9
exception as well as an Article 6 basis. A tattoo service does not automatically
qualify for the medical-care exception. Keep health/consent documents out of
ordinary notes and reports unless a separately reviewed workflow supports them.
An artist checking a declaration is not the client's explicit consent.
[AEPD health-data rules](https://www.aepd.es/areas-de-actuacion/salud/tus-derechos-en-relacion-con-tus-datos-de-salud).

## Processing inventory / RAT template

Maintain both controller and processor records. The small-organisation exception
does not exempt recurring SaaS processing merely because there are fewer than
250 employees.
[AEPD RAT requirement](https://www.aepd.es/preguntas-frecuentes/2-tus-obligaciones-como-responsable-del-tratamiento/7-registro-de-actividades-de-tratamiento/FAQ-0249-estoy-obligado-a-elaborar-un-rat).

Use the following starting inventory; confirm deployed fields and locations.
For each row record: owner/controller contact, purpose, subjects, data categories,
lawful basis/instructions, recipients, transfer country/mechanism, retention
trigger/maximum, access roles, security controls, erasure method and review date.
The processor RAT must identify every artist controller for whom work is done.

| Activity | Data / storage to inspect | Role and retention decision |
| --- | --- | --- |
| Artist account and settings | Name, email, profile/studio details, language, reminder template; PostgreSQL `user` | Operator controller; active account and justified post-closure periods: **REVIEW** |
| Authentication/recovery | Sessions, IP/user-agent fields, credential hashes, provider identifiers/tokens, expiring verification records; database and cookies | Operator controller; assess session lifetime, expired-record cleanup and credential minimisation: **REVIEW** |
| Security/essential operation | Safe server outcomes, account IDs, timestamps, private diagnostic files; proxy/server logs; temporary rate-limit identifiers | Operator controller for own protection; document necessity/LIA and each log's actual retention |
| Optional browser diagnostics | Safe event codes and device/context fields linked to a consenting account | Implemented default-off, separate opt-in, timestamp/version evidence and withdrawal; **not yet deployed**; keep separate from essential operation |
| Requested support reports | Artist narrative, report reference, timestamps and attached safe context; private report files | Operator controller for support; review narrative access and incidental client data; do not promise absolute anonymity |
| Client/appointment records | Client contacts/notes, bookings/status, recorded manual prices/deposits/payments; database | Artist controller / operator processor; artist's documented retention and rights instructions |
| Artwork | Original/preview files plus names, titles, notes and booking links; database and private design directory | Artist controller / operator processor where identifiable; purge files as well as metadata |
| Browser drafts/preferences | Appointment form values in session storage; report drafts in memory; language preference storage | Client draft content follows artist instructions; inventory keys, expiry, account isolation and clear-on-completion/sign-out behaviour |
| Providers/outbound links | Google identity, Cloudflare proxy; conditional Resend; artist-triggered WhatsApp link | Review actual recipient role/data/countries; do not list disabled services as current processors |
| Backups/recovery | Database, artwork, any logs included, secrets/recovery records and erasure ledger | Roles follow underlying data; set expiry, access limits and restoration suppression procedure |

Provide accurate collection information before account/report submission: actual
controller/contact, purposes/bases, recipients/transfers, retention criteria,
rights and complaint route, and representative/DPO where applicable. Supply
artists with material to explain the processor to clients without substituting
the operator's identity for the artist's. Layered presentation is recommended.
[AEPD information requirements](https://www.aepd.es/derechos-y-deberes/conoce-tus-derechos/derecho-de-informacion).

## Browser storage and optional diagnostics

Inventory every cookie/storage/access operation in a clean browser. Necessary
session authentication and user-selected language can qualify for exceptions;
persistent login and draft storage need their own necessity assessment. The AEPD
lists the authentication example as session-only. Do not assume every first-party
operation is exempt.
[AEPD cookie guide, pages 10–12](https://www.aepd.es/guias/guia-cookies.pdf).

The prepared implementation defaults optional diagnostics off, uses a separate
informed affirmative choice and records its time and notice version. Both browser
emission and authenticated server intake require consent. Withdrawal stops intake
even while another device has an unsaved form open; failed purges retain a durable
retry flag. Re-enabling cannot bypass an unfinished purge. A manual report remains
available without diagnostics, with a warning to omit client and health details.
This implementation is locally tested and has not shipped to production.

New login cookies default to browser-session scope, with server sessions capped
at one day. An unchecked-by-default choice explicitly permits remembered login
for thirty days, shared by Google and password sign-in. Confirmed logout removes
the choice. OAuth tokens and unused avatars are discarded; maintenance also
cleans dormant stored Google credentials. Tinta-only appointment drafts are
pruned, capped at twenty and cleared after confirmed sign-out or account change.

JavaScript access can engage terminal-access rules without setting a cookie.
Account-linked diagnostics do not fit AEPD's narrow anonymous audience-statistics
exemption. Assess strictly necessary security/operation separately and document
the decision.
[EDPB 2/2023, paragraph 33](https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf),
[AEPD audience measurement conditions](https://www.aepd.es/guias/guia-cookies-analiticas-externas.pdf).

## Rights procedure

1. Monitor the published route; log receipt date, requester, scope, role and due
   date with minimal information. Requests are normally free. Respond within one
   month; a necessary complexity/volume extension of up to two further months must
   be explained during the first month. Give reasons and complaint information
   when declining.
2. Verify identity and authority proportionately using the existing authenticated
   account or other sufficient evidence. Ask for extra information only where
   justified; do not require/store an identity-document copy by default. A client
   request goes to its artist controller, with prompt processor assistance.
3. Locate relevant database, artwork, support/security/provider and backup copies.
   Scope access/export to the requester and exclude other artists/clients. Assess
   access, correction, erasure, restriction, portability, objection and consent
   withdrawal according to the request and applicable conditions. A bulk account
   export alone may not answer every right.
4. For erasure, check justified legal/claims exceptions and applicable accounting
   retention. Retain only necessary financial evidence with restricted access;
   do not use a financial obligation to retain unrelated notes/artwork. Obtain
   the artist's instruction for client records. If Spanish LOPDGDD applies,
   assess Article 32 blocking and limitation periods; blocked data must be
   unavailable for ordinary use and destroyed at expiry.
5. Perform reviewed changes, coordinate required recipient updates, record outcome
   and restoration suppression, and send the decision within the deadline. Keep
   minimal evidence of completion and its own justified retention. Self-service
   features help but do not replace this procedure.

[AEPD rights procedure](https://www.aepd.es/guias/guia-rgpd-para-responsables-de-tratamiento.pdf),
[AEPD identity verification guidance](https://www.aepd.es/documento/formulario-derecho-de-supresion.pdf),
[AEPD erasure exceptions](https://www.aepd.es/preguntas-frecuentes/1-tus-derechos/2-tus-derechos-de-proteccion-de-datos/FAQ-0111-que-es-el-derecho-de-supresion-derecho-al-olvido),
[LOPDGDD Article 32](https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673#a3-4).

## Retention, erasure and restoration evidence

Set justified periods/criteria for every inventory row and publish the actual
behaviour. The prepared implementation prunes thirty-calendar-day log files on
writes, startup and every fifteen minutes while the single Node instance runs.
The runtime flag is enabled by the production launcher and Docker runner, not by
the build. Downtime delays cleanup until restart; monitor failures and verify
the actual deployment before making retention claims. Backup and proxy-log
periods require their own review. This frequency is an operational choice, not a
statutory GDPR period. Review
retention at least on changes and periodically; assign an owner and failure alert.
[AEPD minimisation and retention principles](https://www.aepd.es/en/rights-and-duties/fulfill-your-duties/principles).

For each purge, retain a minimal job/result record: release, category, cutoff,
counts, success/failure, operator and follow-up. Check that detached originals and
previews, exports and support copies are covered. Never put erased content into
the evidence record. Do not execute blanket database deletion merely to satisfy
this checklist.

Full-account erasure requires recent sign-in, exact email confirmation and an
artist retention-review instruction. It marks the user pending, revokes every
session and blocks new sessions. Owned originals/previews and account-linked
logs must be cleaned before the database cascade is confirmed complete. Storage
failure returns pending rather than complete; maintenance retries. A minimal
SHA-256 account-identifier marker prevents late log writes for thirty days. It
is pseudonymous and **does not replace a backup restoration-suppression ledger**.
Unreferenced artwork files older than twenty-four hours are removed by maintenance;
referenced files and fresh uploads are retained. Individual-client erasure keeps
shared library artwork for the artist's separately confirmed review.

Account exports include profile, provider/session metadata, owned business data
and linked reports/diagnostics, excluding bearer tokens, passwords and physical
storage keys. Client exports are scoped to the selected owned client and linked
owned records. These tools assist rights handling; they do not resolve all rights,
exceptional legal retention, backup recovery or provider copies automatically.

Define backup expiry and whether targeted erasure is possible. Where historical
copies remain until reviewed expiry, restrict them from ordinary use and document
the justified limits. Maintain a protected, minimally identifying erasure/
restriction ledger for the necessary recovery window. Restore in isolation;
reapply later erasures, corrections and restrictions before opening access, then
verify missing files/records and record the test. A restore must not silently
reintroduce removed personal data.

## Providers, transfers and security

Keep a live provider register: legal entity, function/data, controller/processor
role, contractual agreement/version, locations and remote access, subprocessors,
transfer mechanism/evidence, approval/change notice and review date. Verify Google
identity and Cloudflare's actual processing separately; hosting on the operator's
own server does not remove proxy processing. Resend is conditional while disabled;
complete review before enabling recovery email. WhatsApp click-to-chat is a
separate artist-initiated disclosure; review message content and recipient rules.
Do not claim EU-only processing, SCCs, DPF coverage or encryption without evidence.
Transfers require an applicable adequacy decision or appropriate safeguards and
the associated assessment; match the precise recipient and service.
[AEPD transfer rules](https://www.aepd.es/derechos-y-deberes/cumple-tus-deberes/medidas-de-cumplimiento/garantias-transferencias-datos-personales).

Document risk assessment and suitable technical/organisational controls; screen
for DPIA/DPO requirements and revisit scale/sensitive-data changes. Practical
checks: minimum named administrator access and revocation; tenant isolation;
private artwork/log permissions and no public caching; secure secret handling;
patch/dependency review; encryption in transit/at rest and key-management
assessment; backup alerts; isolated restore tests; and deletion/restriction tests.
These checks are not claims that deployment controls are already configured.
[AEPD security requirement](https://www.aepd.es/derechos-y-deberes/cumple-tus-deberes/medidas-de-cumplimiento/seguridad-de-los-tratamientos),
[AEPD risk assessment](https://www.aepd.es/preguntas-frecuentes/2-tus-obligaciones-como-responsable-del-tratamiento/9-analisis-de-riesgos/FAQ-0222-en-que-consiste-el-analisis-de-riesgo-al-que-se-refiere-el-rgpd).

## Breach response

Preserve proportionate evidence, contain the incident, identify affected data/
artists and record awareness time, facts, consequences and corrective measures.
For artist client data, notify each affected artist controller without undue
delay, with available information and updates; the processor does not wait
72 hours or finish its own risk assessment first. Follow the agreed contact route.

For data the operator controls, assess risk promptly. Notify the competent
authority without undue delay and within 72 hours of awareness unless risk to
people is unlikely; explain delay and supplement an initial notification if
facts are incomplete. Communicate probable high-risk breaches to affected people
without undue delay, subject to applicable exceptions. The artist makes its
controller decisions for its client data unless notification on its behalf is
expressly agreed. Document all personal-data breaches, including decisions not
to notify, and retain incident evidence under a justified separate schedule.
[AEPD breach guidance](https://www.aepd.es/guias/guia-brechas-seguridad.pdf).
