import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

const expenseCategories = [
  "Løn",
  "Husleje",
  "Software & abonnementer",
  "Markedsføring",
  "Rejser",
  "Kontorartikler",
  "Rådgivning (revisor/advokat)",
  "Forsikring",
  "IT & udstyr",
  "Diverse",
];

const incomeCategories = ["Salg af varer", "Salg af ydelser", "Abonnementsindtægt", "Andet"];

const businessAreas = ["Produkt A", "Produkt B", "Konsulentydelser", "Fælles/admin"];

async function main() {
  for (const name of expenseCategories) {
    await prisma.category.upsert({
      where: { name_type: { name, type: "EXPENSE" } },
      update: {},
      create: { name, type: "EXPENSE" },
    });
  }

  for (const name of incomeCategories) {
    await prisma.category.upsert({
      where: { name_type: { name, type: "INCOME" } },
      update: {},
      create: { name, type: "INCOME" },
    });
  }

  for (const name of businessAreas) {
    await prisma.businessArea.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  console.log("Seed færdig.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
