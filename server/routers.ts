import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { TRPCError } from "@trpc/server";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  blog: router({
    // Public procedures - anyone can view published posts
    list: publicProcedure
      .input(z.object({ includeUnpublished: z.boolean().optional() }).optional())
      .query(async ({ input, ctx }) => {
        const includeUnpublished = ctx.user?.role === 'admin' && input?.includeUnpublished;
        return await db.getAllBlogPosts(includeUnpublished || false);
      }),

    getBySlug: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input, ctx }) => {
        const includeUnpublished = ctx.user?.role === 'admin';
        const post = await db.getBlogPostBySlug(input.slug, includeUnpublished || false);
        
        if (!post) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Blog post not found' });
        }

        // Increment view count for published posts
        if (post.published === 1) {
          await db.incrementBlogPostViews(post.id);
        }

        return post;
      }),

    search: publicProcedure
      .input(z.object({ query: z.string() }))
      .query(async ({ input, ctx }) => {
        const includeUnpublished = ctx.user?.role === 'admin';
        return await db.searchBlogPosts(input.query, includeUnpublished || false);
      }),

    getByCategory: publicProcedure
      .input(z.object({ category: z.string() }))
      .query(async ({ input, ctx }) => {
        const includeUnpublished = ctx.user?.role === 'admin';
        return await db.getBlogPostsByCategory(input.category, includeUnpublished || false);
      }),

    getBySeries: publicProcedure
      .input(z.object({ seriesName: z.string() }))
      .query(async ({ input, ctx }) => {
        const includeUnpublished = ctx.user?.role === 'admin';
        return await db.getBlogPostsBySeries(input.seriesName, includeUnpublished || false);
      }),

    getCategories: publicProcedure.query(async () => {
      return await db.getAllCategories();
    }),

    getSeries: publicProcedure.query(async () => {
      return await db.getAllSeries();
    }),

    // Protected procedures - admin only
    create: protectedProcedure
      .input(z.object({
        title: z.string().min(1).max(255),
        slug: z.string().min(1).max(255),
        content: z.string().min(1),
        excerpt: z.string().optional(),
        coverImage: z.string().optional(),
        tags: z.string().optional(),
        category: z.string().optional(),
        seriesName: z.string().optional(),
        seriesOrder: z.number().optional(),
        published: z.number().min(0).max(1).default(0),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'admin') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
        }

        const insertId = await db.createBlogPost({
          ...input,
          authorId: ctx.user.id,
          publishedAt: input.published === 1 ? new Date() : null,
        });

        return { id: insertId };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().min(1).max(255).optional(),
        slug: z.string().min(1).max(255).optional(),
        content: z.string().min(1).optional(),
        excerpt: z.string().optional(),
        coverImage: z.string().optional(),
        tags: z.string().optional(),
        category: z.string().optional(),
        seriesName: z.string().optional(),
        seriesOrder: z.number().optional(),
        published: z.number().min(0).max(1).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'admin') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
        }

        const { id, ...updates } = input;
        
        // If publishing, set publishedAt
        if (updates.published === 1) {
          const post = await db.getBlogPostById(id);
          if (post && !post.publishedAt) {
            (updates as any).publishedAt = new Date();
          }
        }

        await db.updateBlogPost(id, updates);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'admin') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
        }

        await db.deleteBlogPost(input.id);
        return { success: true };
      }),

    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        if (ctx.user.role !== 'admin') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
        }

        const post = await db.getBlogPostById(input.id);
        if (!post) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Blog post not found' });
        }

        return post;
      }),
  }),
});

export type AppRouter = typeof appRouter;
