import { describe, expect, it, beforeAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createMockContext(role: "admin" | "user" = "user"): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("blog procedures", () => {
  // Ensure test user exists in database before running tests
  beforeAll(async () => {
    await db.upsertUser({
      openId: "test-user",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "manus",
      role: "admin",
    });
  });
  describe("blog.list", () => {
    it("returns empty array when no posts exist", async () => {
      const ctx = createMockContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.blog.list();
      expect(Array.isArray(result)).toBe(true);
    });

    it("only returns published posts for non-admin users", async () => {
      const ctx = createMockContext("user");
      const caller = appRouter.createCaller(ctx);

      const result = await caller.blog.list();
      expect(Array.isArray(result)).toBe(true);
      // All returned posts should be published
      result.forEach(post => {
        expect(post.published).toBe(1);
      });
    });

    it("can return unpublished posts for admin users", async () => {
      const ctx = createMockContext("admin");
      const caller = appRouter.createCaller(ctx);

      const result = await caller.blog.list({ includeUnpublished: true });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("blog.create", () => {
    it("allows admin to create a blog post", async () => {
      const ctx = createMockContext("admin");
      const caller = appRouter.createCaller(ctx);

      const newPost = {
        title: "Test Post",
        slug: "test-post",
        content: "This is a test post content",
        excerpt: "Test excerpt",
        tags: "test,vitest",
        published: 0,
      };

      const result = await caller.blog.create(newPost);
      expect(result).toHaveProperty("id");
      expect(typeof result.id).toBe("number");
    });

    it("rejects non-admin users from creating posts", async () => {
      const ctx = createMockContext("user");
      const caller = appRouter.createCaller(ctx);

      const newPost = {
        title: "Test Post",
        slug: "test-post-user",
        content: "This should fail",
        published: 0,
      };

      await expect(caller.blog.create(newPost)).rejects.toThrow("Admin access required");
    });

    it("sets publishedAt when creating a published post", async () => {
      const ctx = createMockContext("admin");
      const caller = appRouter.createCaller(ctx);

      const newPost = {
        title: "Published Test Post",
        slug: "published-test-post",
        content: "This is published",
        published: 1,
      };

      const result = await caller.blog.create(newPost);
      expect(result.id).toBeDefined();

      // Verify the post was created with publishedAt
      const post = await db.getBlogPostById(result.id);
      expect(post).toBeDefined();
      expect(post?.publishedAt).toBeDefined();
    });
  });

  describe("blog.update", () => {
    it("allows admin to update a blog post", async () => {
      const ctx = createMockContext("admin");
      const caller = appRouter.createCaller(ctx);

      // First create a post
      const createResult = await caller.blog.create({
        title: "Original Title",
        slug: "original-slug",
        content: "Original content",
        published: 0,
      });

      // Then update it
      const updateResult = await caller.blog.update({
        id: createResult.id,
        title: "Updated Title",
        content: "Updated content",
      });

      expect(updateResult.success).toBe(true);

      // Verify the update
      const post = await db.getBlogPostById(createResult.id);
      expect(post?.title).toBe("Updated Title");
      expect(post?.content).toBe("Updated content");
    });

    it("rejects non-admin users from updating posts", async () => {
      const ctx = createMockContext("user");
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.blog.update({
          id: 1,
          title: "Hacked Title",
        })
      ).rejects.toThrow("Admin access required");
    });
  });

  describe("blog.delete", () => {
    it("allows admin to delete a blog post", async () => {
      const ctx = createMockContext("admin");
      const caller = appRouter.createCaller(ctx);

      // Create a post to delete
      const createResult = await caller.blog.create({
        title: "To Be Deleted",
        slug: "to-be-deleted",
        content: "This will be deleted",
        published: 0,
      });

      // Delete it
      const deleteResult = await caller.blog.delete({ id: createResult.id });
      expect(deleteResult.success).toBe(true);

      // Verify it's gone
      const post = await db.getBlogPostById(createResult.id);
      expect(post).toBeUndefined();
    });

    it("rejects non-admin users from deleting posts", async () => {
      const ctx = createMockContext("user");
      const caller = appRouter.createCaller(ctx);

      await expect(caller.blog.delete({ id: 1 })).rejects.toThrow("Admin access required");
    });
  });

  describe("blog.getBySlug", () => {
    it("returns a published post by slug", async () => {
      const ctx = createMockContext("admin");
      const caller = appRouter.createCaller(ctx);

      // Create a published post
      const createResult = await caller.blog.create({
        title: "Slug Test Post",
        slug: "slug-test-post",
        content: "Testing slug retrieval",
        published: 1,
      });

      // Retrieve it by slug
      const post = await caller.blog.getBySlug({ slug: "slug-test-post" });
      expect(post).toBeDefined();
      expect(post.title).toBe("Slug Test Post");
      expect(post.slug).toBe("slug-test-post");
    });

    it("throws NOT_FOUND for non-existent slug", async () => {
      const ctx = createMockContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.blog.getBySlug({ slug: "non-existent-slug" })
      ).rejects.toThrow("Blog post not found");
    });
  });

  describe("blog.search", () => {
    it("finds posts matching search query", async () => {
      const ctx = createMockContext("admin");
      const caller = appRouter.createCaller(ctx);

      // Create a post with searchable content
      await caller.blog.create({
        title: "Searchable Post About React",
        slug: "searchable-react-post",
        content: "This post discusses React hooks and components",
        published: 1,
      });

      // Search for it
      const results = await caller.blog.search({ query: "React" });
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(post => post.title.includes("React"))).toBe(true);
    });

    it("returns empty array when no matches found", async () => {
      const ctx = createMockContext();
      const caller = appRouter.createCaller(ctx);

      const results = await caller.blog.search({ query: "nonexistentquery12345" });
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });
  });
});
