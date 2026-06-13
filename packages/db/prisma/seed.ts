import { config } from "dotenv";
import path from "path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/index";

config({ path: path.resolve(__dirname, "../../../.env") });

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding demo data...");

  // ── Merchant user ──────────────────────────────────────────────
  const merchantUser =
    (await prisma.user.findUnique({ where: { phone: "+27810000001" } })) ??
    (await prisma.user.create({
      data: { phone: "+27810000001", name: "Demo Merchant", isVerified: true, role: "MERCHANT" },
    }));

  const merchant =
    (await prisma.merchant.findUnique({ where: { userId: merchantUser.id } })) ??
    (await prisma.merchant.create({ data: { userId: merchantUser.id, isApproved: true } }));

  // ── Store 1: Mama's Kitchen ────────────────────────────────────
  const kitchen = await prisma.store.upsert({
    where: { id: "store-mamas-kitchen" },
    update: { isApproved: true, isOpen: true },
    create: {
      id: "store-mamas-kitchen",
      merchantId: merchant.id,
      name: "Mama's Kitchen",
      description: "Home-cooked African meals delivered fresh to your door.",
      phone: "+27810000001",
      address: "12 Mohlakeng St, Soweto",
      lat: -26.265,
      lng: 27.859,
      isOpen: true,
      isApproved: true,
      openTime: "08:00",
      closeTime: "20:00",
      deliveryFee: "20",
      minimumOrder: "50",
      rating: 4.7,
    },
  });

  const foodCat = await prisma.storeCategory.upsert({
    where: { id: "cat-food-mains" },
    update: {},
    create: { id: "cat-food-mains", storeId: kitchen.id, name: "Food" },
  });

  const sidesCat = await prisma.storeCategory.upsert({
    where: { id: "cat-food-sides" },
    update: {},
    create: { id: "cat-food-sides", storeId: kitchen.id, name: "Sides & Drinks" },
  });

  const kitchenProducts = [
    { id: "prod-pap-vleis", name: "Pap & Vleis", description: "Soft pap with braai beef and gravy", price: "65", categoryId: foodCat.id },
    { id: "prod-chakalaka", name: "Chakalaka Plate", description: "Spicy bean relish with rice", price: "45", categoryId: foodCat.id },
    { id: "prod-mogodu", name: "Mogodu (Tripe)", description: "Traditional slow-cooked tripe", price: "70", categoryId: foodCat.id },
    { id: "prod-chicken-feet", name: "Walkie Talkies", description: "Grilled chicken feet & heads", price: "35", categoryId: foodCat.id },
    { id: "prod-amasi", name: "Amasi (Sour Milk)", description: "Traditional fermented milk, 500ml", price: "18", categoryId: sidesCat.id },
    { id: "prod-mageu", name: "Mageu", description: "Non-alcoholic fermented drink, 1L", price: "22", categoryId: sidesCat.id },
  ];

  for (const p of kitchenProducts) {
    await prisma.product.upsert({
      where: { id: p.id },
      update: {},
      create: { ...p, storeId: kitchen.id, isAvailable: true },
    });
  }

  // ── Store 2: TownSquare Grocery ────────────────────────────────
  const grocery = await prisma.store.upsert({
    where: { id: "store-townsquare-grocery" },
    update: { isApproved: true, isOpen: true },
    create: {
      id: "store-townsquare-grocery",
      merchantId: merchant.id,
      name: "TownSquare Grocery",
      description: "Your neighbourhood spaza shop — everyday essentials fast.",
      phone: "+27810000001",
      address: "45 Khumalo Ave, Alexandra",
      lat: -26.102,
      lng: 28.099,
      isOpen: true,
      isApproved: true,
      openTime: "06:00",
      closeTime: "22:00",
      deliveryFee: "15",
      minimumOrder: "30",
      rating: 4.3,
    },
  });

  const groceryCat = await prisma.storeCategory.upsert({
    where: { id: "cat-grocery-staples" },
    update: {},
    create: { id: "cat-grocery-staples", storeId: grocery.id, name: "Grocery" },
  });

  const snacksCat = await prisma.storeCategory.upsert({
    where: { id: "cat-grocery-snacks" },
    update: {},
    create: { id: "cat-grocery-snacks", storeId: grocery.id, name: "Snacks & Cool Drinks" },
  });

  const groceryProducts = [
    { id: "prod-ace-pap", name: "ACE Maize Meal 5kg", description: "White maize meal, 5kg bag", price: "55", categoryId: groceryCat.id },
    { id: "prod-sunflower-oil", name: "Sunflower Oil 2L", description: "Pure sunflower cooking oil", price: "48", categoryId: groceryCat.id },
    { id: "prod-eggs-dozen", name: "Free Range Eggs (12)", description: "Large free range eggs", price: "38", categoryId: groceryCat.id },
    { id: "prod-bread-white", name: "Albany White Bread", description: "700g sliced white bread", price: "20", categoryId: groceryCat.id },
    { id: "prod-simba-chips", name: "Simba Chips 36g", description: "Assorted flavours", price: "8", categoryId: snacksCat.id },
    { id: "prod-coke-330", name: "Coca-Cola 330ml", description: "Ice cold Coke can", price: "12", categoryId: snacksCat.id },
    { id: "prod-red-bull", name: "Red Bull 250ml", description: "Energy drink", price: "22", categoryId: snacksCat.id },
  ];

  for (const p of groceryProducts) {
    await prisma.product.upsert({
      where: { id: p.id },
      update: {},
      create: { ...p, storeId: grocery.id, isAvailable: true },
    });
  }

  // ── Store 3: Pharm24 ───────────────────────────────────────────
  const pharmacy = await prisma.store.upsert({
    where: { id: "store-pharm24" },
    update: { isApproved: true, isOpen: false },
    create: {
      id: "store-pharm24",
      merchantId: merchant.id,
      name: "Pharm24",
      description: "Medicines, vitamins & health essentials. Open 24 hours.",
      phone: "+27810000001",
      address: "8 Nelson Mandela Drive, Tembisa",
      lat: -26.003,
      lng: 28.224,
      isOpen: false,
      isApproved: true,
      openTime: "00:00",
      closeTime: "23:59",
      deliveryFee: "25",
      minimumOrder: "0",
      rating: 4.5,
    },
  });

  const pharmCat = await prisma.storeCategory.upsert({
    where: { id: "cat-pharm-otc" },
    update: {},
    create: { id: "cat-pharm-otc", storeId: pharmacy.id, name: "Pharmacy" },
  });

  const pharmVitCat = await prisma.storeCategory.upsert({
    where: { id: "cat-pharm-vitamins" },
    update: {},
    create: { id: "cat-pharm-vitamins", storeId: pharmacy.id, name: "Vitamins & Supplements" },
  });

  const pharmProducts = [
    { id: "prod-panado", name: "Panado 500mg (24 tabs)", description: "Paracetamol pain relief", price: "32", categoryId: pharmCat.id },
    { id: "prod-rennies", name: "Rennies 36 tabs", description: "Antacid chewable tablets", price: "28", categoryId: pharmCat.id },
    { id: "prod-ors", name: "Oral Rehydration Salts (6pk)", description: "Electrolyte sachets", price: "24", categoryId: pharmCat.id },
    { id: "prod-vit-c", name: "Vitamin C 1000mg (30 tabs)", description: "Immune support", price: "45", categoryId: pharmVitCat.id },
    { id: "prod-vit-d", name: "Vitamin D3 1000IU (60 tabs)", description: "Bone & immune health", price: "55", categoryId: pharmVitCat.id },
  ];

  for (const p of pharmProducts) {
    await prisma.product.upsert({
      where: { id: p.id },
      update: {},
      create: { ...p, storeId: pharmacy.id, isAvailable: true },
    });
  }

  // ── Store 4: Kasi Fashion Hub ──────────────────────────────────
  const fashion = await prisma.store.upsert({
    where: { id: "store-kasi-fashion" },
    update: { isApproved: true, isOpen: true },
    create: {
      id: "store-kasi-fashion",
      merchantId: merchant.id,
      name: "Kasi Fashion Hub",
      description: "Streetwear, sneakers and urban fashion from local designers.",
      phone: "+27810000001",
      address: "22 Vilakazi St, Orlando West",
      lat: -26.280,
      lng: 27.893,
      isOpen: true,
      isApproved: true,
      openTime: "09:00",
      closeTime: "18:00",
      deliveryFee: "30",
      minimumOrder: "100",
      rating: 4.6,
    },
  });

  const fashionCat = await prisma.storeCategory.upsert({
    where: { id: "cat-fashion-clothing" },
    update: {},
    create: { id: "cat-fashion-clothing", storeId: fashion.id, name: "Fashion" },
  });

  const sneakerCat = await prisma.storeCategory.upsert({
    where: { id: "cat-fashion-sneakers" },
    update: {},
    create: { id: "cat-fashion-sneakers", storeId: fashion.id, name: "Sneakers & Footwear" },
  });

  const fashionProducts = [
    { id: "prod-bucket-hat", name: "Kasi Bucket Hat", description: "Embroidered cotton bucket hat", price: "180", categoryId: fashionCat.id },
    { id: "prod-cargo-pants", name: "Urban Cargo Pants", description: "Multi-pocket cargo, various colours", price: "350", categoryId: fashionCat.id },
    { id: "prod-graphic-tee", name: "SA Graphic Tee", description: "Local artist screen-print t-shirt", price: "220", categoryId: fashionCat.id },
    { id: "prod-takkies-low", name: "Low-Top Canvas Takkies", description: "Classic low-top sneakers", price: "450", categoryId: sneakerCat.id },
    { id: "prod-slides", name: "Kasi Slides", description: "Comfortable foam slides", price: "150", categoryId: sneakerCat.id },
  ];

  for (const p of fashionProducts) {
    await prisma.product.upsert({
      where: { id: p.id },
      update: {},
      create: { ...p, storeId: fashion.id, isAvailable: true },
    });
  }

  // ── Demo Driver ────────────────────────────────────────────────
  const driverUser =
    (await prisma.user.findUnique({ where: { phone: "+27820000002" } })) ??
    (await prisma.user.create({
      data: { phone: "+27820000002", name: "Sipho Driver", isVerified: true, role: "DRIVER" },
    }));

  const driver =
    (await prisma.driver.findUnique({ where: { userId: driverUser.id } })) ??
    (await prisma.driver.create({
      data: {
        userId: driverUser.id,
        licenseNumber: "DL-DEMO-0001",
        idNumber: "9001015800087",
        isApproved: true,
        isOnline: false,
        rating: 4.8,
        currentLat: -26.2041,
        currentLng: 28.0473,
      },
    }));

  const existingVehicle = await prisma.vehicle.findUnique({ where: { driverId: driver.id } });
  if (!existingVehicle) {
    await prisma.vehicle.create({
      data: {
        driverId: driver.id,
        type: "SEDAN",
        make: "Toyota",
        model: "Corolla",
        year: 2020,
        color: "White",
        licensePlate: "CR 123 GP",
        isApproved: true,
      },
    });
  }

  console.log("✅ Seeded:");
  console.log(`   • 1 merchant`);
  console.log(`   • 4 stores (Mama's Kitchen, TownSquare Grocery, Pharm24, Kasi Fashion Hub)`);
  console.log(`   • 8 categories`);
  console.log(`   • ${kitchenProducts.length + groceryProducts.length + pharmProducts.length + fashionProducts.length} products`);
  console.log(`   • 1 driver (Sipho Driver, +27820000002, White Toyota Corolla CR 123 GP)`);
}

main()
  .catch((e) => { console.error("❌ Seed failed:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
