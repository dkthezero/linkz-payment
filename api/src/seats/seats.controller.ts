import { Controller, Get, Param } from '@nestjs/common';
// TODO: enable mutating endpoints once admin authorization is defined.
// import { Body, Post, Patch, Delete } from '@nestjs/common';
import { SeatsService } from './seats.service';

@Controller('seats')
export class SeatsController {
  constructor(private readonly service: SeatsService) {}

  @Get()
  async findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.service.findById(id);
  }

  // TODO: POST /api/seats — admin-only seat creation.
  // @Post()
  // async create(@Body() dto: CreateSeatDto) {
  //   return this.service.create(dto);
  // }

  // TODO: PATCH /api/seats/:id — admin-only seat update.
  // @Patch(':id')
  // async update(@Param('id') id: string, @Body() dto: UpdateSeatDto) {
  //   return this.service.update(id, dto);
  // }

  // TODO: DELETE /api/seats/:id — admin-only seat deletion.
  // @Delete(':id')
  // async remove(@Param('id') id: string) {
  //   return this.service.remove(id);
  // }
}
