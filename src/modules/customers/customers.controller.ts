import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { PlanLimit, ReadOnlyAllowed, RequirePermission } from '../../common/decorators'
import { PageDto } from '../../common/dto/pagination.dto'
import { CustomersService } from './customers.service'
import {
  CreateCustomerDto,
  CustomerQueryDto,
  UpdateCustomerDto,
} from './dto/customer.dto'
import { Customer } from './entities/customer.entity'

@ApiTags('customers')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission('customers:read')
  @ReadOnlyAllowed()
  @ApiOperation({ summary: 'Lista clientes com busca, filtro e paginação' })
  list(@Query() query: CustomerQueryDto): Promise<PageDto<Customer>> {
    return this.customers.list(query)
  }

  @Get(':id')
  @RequirePermission('customers:read')
  @ReadOnlyAllowed()
  @ApiOperation({ summary: 'Detalhe do cliente com responsáveis' })
  @ApiResponse({ status: 404, description: 'Cliente de outro tenant também cai aqui' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Customer> {
    return this.customers.findOne(id)
  }

  @Post()
  @RequirePermission('customers:write')
  @PlanLimit('customers')
  @ApiOperation({ summary: 'Cadastra cliente e seus responsáveis' })
  create(@Body() dto: CreateCustomerDto): Promise<Customer> {
    return this.customers.create(dto)
  }

  @Patch(':id')
  @RequirePermission('customers:write')
  @ApiOperation({ summary: 'Atualiza cliente; `responsibles` substitui a lista inteira' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ): Promise<Customer> {
    return this.customers.update(id, dto)
  }

  @Delete(':id')
  @RequirePermission('customers:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove o cliente (soft delete)',
    description: 'O histórico financeiro é preservado — o registro apenas sai das listas.',
  })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.customers.remove(id)
  }
}
