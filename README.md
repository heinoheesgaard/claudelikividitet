# Business Controller

Overblik over hvor virksomheden bruger penge, og hvilke forretningsområder der er mest indtjenende.

## Funktioner

- **Dashboard** – udgifter fordelt på kategori og indtjening/resultat pr. forretningsområde, med periodefiltre.
- **Transaktioner** – manuel indtastning, redigering og sletning af indtægter/udgifter.
- **Import** – upload en CSV-eksport (fra bank eller bogføringssystem), map kolonner til dato/beløb/kategori/forretningsområde, og importér.
- **Indstillinger** – administrér kategorier og forretningsområder.

## Teknisk stack

Next.js (App Router) + TypeScript + Tailwind CSS, Prisma med SQLite, Recharts til grafer.

## Kom i gang

```bash
npm install
npm run db:migrate   # opretter/opdaterer SQLite-databasen (dev.db)
npm run db:seed      # tilføjer eksempelkategorier og -forretningsområder
npm run dev
```

Åbn [http://localhost:3000](http://localhost:3000).

## Database

Databasen er SQLite (`dev.db`, ikke tjekket ind i git). Skemaet ligger i `prisma/schema.prisma`. Kør `npm run db:migrate` efter ændringer i skemaet.
