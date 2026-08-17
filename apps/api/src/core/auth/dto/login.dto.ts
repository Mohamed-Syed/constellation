import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsString, MinLength } from "class-validator";

/** Body for `POST /api/auth/login`. Validated by the global `ValidationPipe`. */
export class LoginDto {
  @ApiProperty({ example: "admin@constellation.local" })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: "changeme" })
  @IsString()
  @MinLength(1)
  password!: string;
}
