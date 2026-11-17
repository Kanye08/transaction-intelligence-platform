import { Module } from '@nestjs/common';

import { AppConfig, CONFIG_TOKEN } from '../../config/configuration';
import { ReviewModule } from '../review/review.module';
import { ClassificationController } from './classification.controller';
import { ClassificationCorrectionService } from './classification-correction.service';
import { ClassificationService } from './classification.service';
import {
  CLASSIFICATION_PROVIDER,
  ClassificationProvider,
} from './providers/classification-provider';
import { HybridClassificationProvider } from './providers/hybrid.provider';
import { MockLlmClassificationProvider } from './providers/mock-llm.provider';
import { RulesClassificationProvider } from './providers/rules.provider';

/**
 * Which classifier the application uses is a configuration decision, not a
 * code decision: CLASSIFICATION_PROVIDER=rules|mock-llm|hybrid. Everything
 * downstream depends on the interface, so a real LLM provider would be added
 * here and nowhere else.
 */
@Module({
  imports: [ReviewModule],
  controllers: [ClassificationController],
  providers: [
    RulesClassificationProvider,
    MockLlmClassificationProvider,
    HybridClassificationProvider,
    {
      provide: CLASSIFICATION_PROVIDER,
      inject: [
        CONFIG_TOKEN,
        RulesClassificationProvider,
        MockLlmClassificationProvider,
        HybridClassificationProvider,
      ],
      useFactory: (
        config: AppConfig,
        rules: RulesClassificationProvider,
        llm: MockLlmClassificationProvider,
        hybrid: HybridClassificationProvider,
      ): ClassificationProvider => {
        switch (config.classification.provider) {
          case 'rules':
            return rules;
          case 'mock-llm':
            return llm;
          default:
            return hybrid;
        }
      },
    },
    ClassificationService,
    ClassificationCorrectionService,
  ],
  exports: [
    ClassificationService,
    ClassificationCorrectionService,
    CLASSIFICATION_PROVIDER,
    RulesClassificationProvider,
    MockLlmClassificationProvider,
    HybridClassificationProvider,
  ],
})
export class ClassificationModule {}
