# Thypisk Julia

Overblik over hvor virksomheden bruger penge, hvilke forretningsområder der er mest indtjenende, og et register over bilag sendt til revisor.

## Funktioner

- **Dashboard** – udgifter fordelt på kategori og indtjening/resultat pr. forretningsområde, med periodefiltre.
- **Transaktioner** – manuel indtastning, redigering og sletning af indtægter/udgifter.
- **Bilag** – register over bilag sendt til `revisorkurt@thypisk.dk`, uafhængigt af om economic kunne læse dem. Bekræft et beløb for at bogføre bilaget som en transaktion.
- **Import** – upload en CSV-eksport (fra bank eller bogføringssystem), map kolonner til dato/beløb/kategori/forretningsområde, og importér.
- **Indstillinger** – administrér kategorier og forretningsområder.

## Teknisk stack

Next.js (App Router) + TypeScript + Tailwind CSS, Prisma med PostgreSQL, Recharts til grafer.

## Kom i gang lokalt

Kræver en kørende PostgreSQL-database. Sæt `DATABASE_URL` i `.env`, f.eks.:

```
DATABASE_URL="postgresql://bruger:kodeord@localhost:5432/thypisk_julia"
```

```bash
npm install
npm run db:migrate   # opretter/opdaterer databasen
npm run db:seed      # tilføjer eksempelkategorier og -forretningsområder
npm run dev
```

Åbn [http://localhost:3000](http://localhost:3000).

## Deploy (Vercel)

`npm run build` kører automatisk `prisma migrate deploy` og seed før selve build'et, så det er trygt at bruge som Vercel's build-kommando. Tilføj en Postgres-database via Vercel Storage-fanen, så sættes `DATABASE_URL` automatisk.

## Database

Skemaet ligger i `prisma/schema.prisma`. Kør `npm run db:migrate` efter ændringer i skemaet.
