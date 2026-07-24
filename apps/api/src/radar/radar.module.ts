import { Module } from '@nestjs/common';
import { RadarController } from './radar.controller';
import { RadarService } from './radar.service';

@Module({ controllers: [RadarController], providers: [RadarService] })
export class RadarModule {}
