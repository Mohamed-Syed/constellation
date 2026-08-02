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
}
