// src/app.controller.ts (backend)
import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";

@Controller()
@ApiTags("Health")
export class AppController {
  @Get("health")
  @ApiOperation({ summary: "Health check endpoint" })
  healthCheck() {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      message: "Zinkite API is running",
    };
  }
}
