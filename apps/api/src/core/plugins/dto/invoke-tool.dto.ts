import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsObject, IsOptional, IsString, Matches, MaxLength } from "class-validator";

/**
 * Body for `POST /api/plugins/:id/invoke`. Validated by the global
 * `ValidationPipe` (which is configured `whitelist: true`, so unknown
 * properties are stripped before this ever reaches the controller).
 *
 * `args` is intentionally an opaque object: the manifest's `inputSchema` is
 * data the core does not interpret, so arg validation is the plugin runtime's
 * job. The core validates only the envelope.
 */
export class InvokeToolDto {
  @ApiProperty({
    example: "browser.navigate",
    description: "Name of a tool declared in the plugin's manifest `tools` array.",
  })
  @IsString()
  @MaxLength(200)
  // Tool names are dotted identifiers (e.g. "browser.navigate"). Constraining
  // the charset keeps hostile input out of log lines and audit metadata.
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: "tool must contain only letters, numbers, dots, underscores or hyphens",
  })
  tool!: string;

  @ApiPropertyOptional({
    type: "object",
    additionalProperties: true,
    example: { url: "https://example.com" },
    description: "Arguments forwarded verbatim to the plugin's invokeTool().",
  })
  @IsOptional()
  @IsObject()
  args?: Record<string, unknown>;
}
