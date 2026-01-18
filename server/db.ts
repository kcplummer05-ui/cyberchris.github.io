import { eq, desc, and, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, blogPosts, InsertBlogPost, BlogPost } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Blog post query helpers

export async function getAllBlogPosts(includeUnpublished: boolean = false) {
  const db = await getDb();
  if (!db) return [];

  const conditions = includeUnpublished ? [] : [eq(blogPosts.published, 1)];
  
  return await db
    .select()
    .from(blogPosts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(blogPosts.createdAt));
}

export async function getBlogPostBySlug(slug: string, includeUnpublished: boolean = false) {
  const db = await getDb();
  if (!db) return undefined;

  const conditions = [eq(blogPosts.slug, slug)];
  if (!includeUnpublished) {
    conditions.push(eq(blogPosts.published, 1));
  }

  const result = await db
    .select()
    .from(blogPosts)
    .where(and(...conditions))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getBlogPostById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(blogPosts)
    .where(eq(blogPosts.id, id))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function createBlogPost(post: InsertBlogPost) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(blogPosts).values(post);
  return Number(result[0].insertId);
}

export async function updateBlogPost(id: number, updates: Partial<InsertBlogPost>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(blogPosts)
    .set(updates)
    .where(eq(blogPosts.id, id));
}

export async function deleteBlogPost(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(blogPosts).where(eq(blogPosts.id, id));
}

export async function incrementBlogPostViews(id: number) {
  const db = await getDb();
  if (!db) return;

  await db
    .update(blogPosts)
    .set({ viewCount: sql`${blogPosts.viewCount} + 1` })
    .where(eq(blogPosts.id, id));
}

export async function searchBlogPosts(query: string, includeUnpublished: boolean = false) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [
    sql`(${blogPosts.title} LIKE ${`%${query}%`} OR ${blogPosts.content} LIKE ${`%${query}%`} OR ${blogPosts.tags} LIKE ${`%${query}%`})`
  ];

  if (!includeUnpublished) {
    conditions.push(eq(blogPosts.published, 1));
  }

  return await db
    .select()
    .from(blogPosts)
    .where(and(...conditions))
    .orderBy(desc(blogPosts.createdAt));
}

export async function getBlogPostsByCategory(category: string, includeUnpublished: boolean = false) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [eq(blogPosts.category, category)];
  if (!includeUnpublished) {
    conditions.push(eq(blogPosts.published, 1));
  }

  return await db
    .select()
    .from(blogPosts)
    .where(and(...conditions))
    .orderBy(desc(blogPosts.createdAt));
}

export async function getBlogPostsBySeries(seriesName: string, includeUnpublished: boolean = false) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [eq(blogPosts.seriesName, seriesName)];
  if (!includeUnpublished) {
    conditions.push(eq(blogPosts.published, 1));
  }

  return await db
    .select()
    .from(blogPosts)
    .where(and(...conditions))
    .orderBy(blogPosts.seriesOrder);
}

export async function getAllCategories() {
  const db = await getDb();
  if (!db) return [];

  const result = await db
    .select({ category: blogPosts.category })
    .from(blogPosts)
    .where(and(eq(blogPosts.published, 1), sql`${blogPosts.category} IS NOT NULL`))
    .groupBy(blogPosts.category);

  return result.map(r => r.category).filter(Boolean) as string[];
}

export async function getAllSeries() {
  const db = await getDb();
  if (!db) return [];

  const result = await db
    .select({ seriesName: blogPosts.seriesName })
    .from(blogPosts)
    .where(and(eq(blogPosts.published, 1), sql`${blogPosts.seriesName} IS NOT NULL`))
    .groupBy(blogPosts.seriesName);

  return result.map(r => r.seriesName).filter(Boolean) as string[];
}
