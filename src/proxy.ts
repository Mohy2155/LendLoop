import { clerkMiddleware } from "@clerk/nextjs/server";
import { isSignedInPath } from "@/lib/nav";

/**
 * UX guard only: sends signed-out visitors to sign-in (and back afterwards). It is not the
 * authorization boundary. Data access is enforced inside Convex functions.
 */
export default clerkMiddleware(async (auth, req) => {
  if (isSignedInPath(req.nextUrl.pathname)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
