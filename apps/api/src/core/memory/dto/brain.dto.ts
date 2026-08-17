import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/**
 * Body for `POST /api/brain/remember`. Validated by the global `ValidationPipe`
 * (`whitelist: true, forbidNonWhitelisted: true`), so unknown properties are a
 * 400 before this reaches the controller.
 *
 * Length caps are deliberate: the vault is markdown on disk that a graph engine
 * re-indexes, so an unbounded body is both a disk and an indexing DoS.
 */
export class RememberDto {
  @ApiProperty({ example: "Plugin loader uses pathToFileURL on Windows" })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: "String `file://C:/...` imports fail; pathToFileURL() is required." })
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  body!: string;

  @ApiPropertyOptional({ type: [String], example: ["loader", "windows"] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  @MaxLength(40, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ example: "agent" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  source?: string;
}

/** Body for `POST /api/brain/query`. */
export class QueryDto {
  @ApiProperty({ example: "what connects the plugin loader to the SDK?" })
  @IsString()
  @MinLength(2)
  @MaxLength(2_000)
  question!: string;
}
