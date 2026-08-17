import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class CreateTaskDto {
  @IsString()
  title!: string;

  @IsString()
  prompt!: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxSteps?: number;

  /** Hard per-task token ceiling. Null = platform default (ENGINE_MAX_TOKENS_PER_TASK). */
  @IsOptional()
  @IsInt()
  @Min(1)
  maxTokens?: number;

  /** Team spaces round: the team this task belongs to (null = personal). */
  @IsOptional()
  @IsString()
  teamId?: string;
}
