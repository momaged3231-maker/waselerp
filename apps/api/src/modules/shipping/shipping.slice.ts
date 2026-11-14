import {
  Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { AuthUser, CurrentUser, RequirePermissions } from '../../common/security';

@Injectable()
export class ShippingService {
  constructor(private readonly db: DatabaseService) {}

  // Countries
  countries() {
    return this.db.query('SELECT country_id AS "countryId", code, name, name_en AS "nameEn", is_active AS "isActive" FROM countries ORDER BY name');
  }
  createCountry(dto: any) {
    return this.db.one('INSERT INTO countries (code, name, name_en, is_active) VALUES ($1,$2,$3,$4) RETURNING country_id', [
      dto.code, dto.name, dto.nameEn ?? null, dto.isActive ?? true,
    ]).then((r) => ({ countryId: Number(r.country_id) }));
  }
  updateCountry(id: number, dto: any) {
    return this.db.query(
      'UPDATE countries SET code=$2, name=$3, name_en=$4, is_active=$5 WHERE country_id=$1',
      [id, dto.code, dto.name, dto.nameEn ?? null, dto.isActive ?? true],
    ).then(() => ({ countryId: id }));
  }

  // Cities
  cities(countryId?: number) {
    return this.db.query(
      `SELECT c.city_id AS "cityId", c.country_id AS "countryId", co.name AS "countryName",
              c.name, c.name_en AS "nameEn", c.is_active AS "isActive"
         FROM cities c JOIN countries co ON co.country_id = c.country_id
        WHERE ($1::int IS NULL OR c.country_id = $1)
        ORDER BY c.name`,
      [countryId ?? null],
    );
  }
  createCity(dto: any) {
    return this.db.one('INSERT INTO cities (country_id, name, name_en, is_active) VALUES ($1,$2,$3,$4) RETURNING city_id', [
      dto.countryId, dto.name, dto.nameEn ?? null, dto.isActive ?? true,
    ]).then((r) => ({ cityId: Number(r.city_id) }));
  }
  updateCity(id: number, dto: any) {
    return this.db.query(
      'UPDATE cities SET country_id=$2, name=$3, name_en=$4, is_active=$5 WHERE city_id=$1',
      [id, dto.countryId, dto.name, dto.nameEn ?? null, dto.isActive ?? true],
    ).then(() => ({ cityId: id }));
  }

  // Shipping methods
  methods() {
    return this.db.query('SELECT shipping_method_id AS "shippingMethodId", code, name, is_active AS "isActive" FROM shipping_methods ORDER BY name');
  }
  createMethod(dto: any) {
    return this.db.one('INSERT INTO shipping_methods (code, name, is_active) VALUES ($1,$2,$3) RETURNING shipping_method_id', [
      dto.code, dto.name, dto.isActive ?? true,
    ]).then((r) => ({ shippingMethodId: Number(r.shipping_method_id) }));
  }

  // Rates
  rates(fromCityId?: number, toCityId?: number) {
    return this.db.query(
      `SELECT r.shipping_rate_id AS "shippingRateId", r.shipping_method_id AS "shippingMethodId",
              m.name AS "methodName", r.from_city_id AS "fromCityId", fc.name AS "fromCityName",
              r.to_city_id AS "toCityId", tc.name AS "toCityName",
              r.rate, r.estimated_days AS "estimatedDays", r.is_active AS "isActive"
         FROM shipping_rates r
         JOIN shipping_methods m ON m.shipping_method_id = r.shipping_method_id
         JOIN cities fc ON fc.city_id = r.from_city_id
         JOIN cities tc ON tc.city_id = r.to_city_id
        WHERE ($1::int IS NULL OR r.from_city_id = $1)
          AND ($2::int IS NULL OR r.to_city_id = $2)
        ORDER BY m.name, fc.name, tc.name`,
      [fromCityId ?? null, toCityId ?? null],
    );
  }
  createRate(dto: any) {
    return this.db.one(
      `INSERT INTO shipping_rates (shipping_method_id, from_city_id, to_city_id, rate, estimated_days, is_active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING shipping_rate_id`,
      [dto.shippingMethodId, dto.fromCityId, dto.toCityId, dto.rate ?? 0, dto.estimatedDays ?? null, dto.isActive ?? true],
    ).then((r) => ({ shippingRateId: Number(r.shipping_rate_id) }));
  }
}

@Controller('shipping')
export class ShippingController {
  constructor(private readonly service: ShippingService) {}

  @RequirePermissions('settings.manage')
  @Get('countries')
  countries() { return this.service.countries(); }
  @RequirePermissions('settings.manage')
  @Post('countries')
  createCountry(@Body() dto: any) { return this.service.createCountry(dto); }
  @RequirePermissions('settings.manage')
  @Put('countries/:id')
  updateCountry(@Param('id', ParseIntPipe) id: number, @Body() dto: any) { return this.service.updateCountry(id, dto); }

  @RequirePermissions('settings.manage')
  @Get('cities')
  cities(@Query('countryId') countryId: string) { return this.service.cities(countryId ? Number(countryId) : undefined); }
  @RequirePermissions('settings.manage')
  @Post('cities')
  createCity(@Body() dto: any) { return this.service.createCity(dto); }
  @RequirePermissions('settings.manage')
  @Put('cities/:id')
  updateCity(@Param('id', ParseIntPipe) id: number, @Body() dto: any) { return this.service.updateCity(id, dto); }

  @RequirePermissions('settings.manage')
  @Get('methods')
  methods() { return this.service.methods(); }
  @RequirePermissions('settings.manage')
  @Post('methods')
  createMethod(@Body() dto: any) { return this.service.createMethod(dto); }

  @RequirePermissions('settings.manage')
  @Get('rates')
  rates(@Query('fromCityId') fromCityId: string, @Query('toCityId') toCityId: string) {
    return this.service.rates(fromCityId ? Number(fromCityId) : undefined, toCityId ? Number(toCityId) : undefined);
  }
  @RequirePermissions('settings.manage')
  @Post('rates')
  createRate(@Body() dto: any) { return this.service.createRate(dto); }
}

@Module({
  controllers: [ShippingController],
  providers: [ShippingService],
  exports: [ShippingService],
})
export class ShippingModule {}
