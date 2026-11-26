import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { SaveScriptDto } from './dto/save-script.dto';
import { ScriptsService } from './scripts.service';

/** Public: what the recording page needs. */
@Controller('scripts')
export class ScriptsController {
  constructor(private readonly scripts: ScriptsService) {}

  @Get()
  async list() {
    return (await this.scripts.active()).map(({ id, title, text, keywords, updatedAt }) => ({ id, title, text, keywords, updatedAt }));
  }
}

@Controller('admin/scripts')
@UseGuards(AdminGuard)
export class AdminScriptsController {
  constructor(private readonly scripts: ScriptsService) {}

  @Get()
  list() {
    return this.scripts.all();
  }

  @Post()
  create(@Body() dto: SaveScriptDto) {
    return this.scripts.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: SaveScriptDto) {
    return this.scripts.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.scripts.remove(id);
  }
}
