import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/public.decorator.js";

/**
 * Product identity — the API's fingerprint.
 *
 * Fixes the D-2 silent-wrong-product bug: when host port 4000 is squatted by
 * an unrelated service (e.g. Looper's LiteLLM gateway), that process answers
 * with VALID JSON instead of a connection error, so a client cannot tell it
 * is talking to the wrong API from HTTP success alone. This endpoint uniquely
 * identifies this process as Constellation.
 *
 * Deliberately @Public and dependency-free: it must answer even with no
 * database, no plugins loaded, and no auth — the one route that ALWAYS
 * identifies the product. `version` is the identity contract, a static
 * literal matching apps/api's package version (0.1.0) — deliberately NOT
 * PLATFORM_VERSION from the SDK (0.2.0): a fingerprint must never drift with
 * platform releases. The portal asserts this shape.
 */
@ApiTags("identity")
@Controller("identity")
export class IdentityController {
  @Public()
  @Get()
  identity() {
    return { product: "constellation", version: "0.1.0", api: true };
  }
}
