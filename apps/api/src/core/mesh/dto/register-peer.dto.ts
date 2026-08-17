import { IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from "class-validator";

/**
 * Register a new mesh peer (Phase 4.0 4.6). `apiKey` is optional — when given,
 * only a SHA-256 hash is stored; the raw key is never persisted.
 * `require_tld: false` so local/dev instances (`http://localhost:4002`) are
 * valid peers alongside production hostnames.
 */
export class RegisterPeerDto {
  /** Human-friendly unique name, e.g. "edge-site-1". */
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name!: string;

  /** Base URL of the peer instance (http/https). */
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false })
  @MaxLength(512)
  baseUrl!: string;

  /** Optional API key for authenticated cross-instance calls (hash-only storage). */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  apiKey?: string;
}
