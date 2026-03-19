const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'AI-MSHM Menstrual Cycle Risk Prediction API',
      version: '1.0.0',
      description: `
## Overview
Predicts disease risk scores for 6 conditions based on a user's menstrual cycle history.

## Diseases Predicted
| Disease | Flag Threshold | Severity Scale |
|---|---|---|
| Infertility | ≥ 0.50 | Minimal / Mild / Moderate / Severe / Extreme |
| Dysmenorrhea | ≥ 0.50 | ← same |
| PMDD | ≥ 0.60 | ← same |
| Endometrial Cancer | ≥ 0.50 | ← same |
| Type 2 Diabetes | ≥ 0.50 | ← same |
| Cardiovascular Disease | ≥ 0.50 | ← same |

## Authentication
All prediction endpoints require \`Authorization: Bearer <token>\`.
Use \`POST /api/v1/auth/token\` to get a test token in development.
      `,
      contact: { name: 'AI-MSHM Platform' },
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Development' },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        PredictionResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            status: { type: 'integer' },
            message: { type: 'string' },
            data: {
              type: 'object',
              properties: {
                predictions: {
                  type: 'object',
                  additionalProperties: {
                    type: 'object',
                    properties: {
                      risk_probability: { type: 'number' },
                      risk_score: { type: 'number' },
                      risk_flag: { type: 'integer' },
                      severity: { type: 'string', enum: ['Minimal', 'Mild', 'Moderate', 'Severe', 'Extreme'] },
                      threshold_used: { type: 'number' }
                    }
                  }
                },
                features_used: { type: 'array', items: { type: 'string' } },
                model_module: { type: 'string' }
              }
            },
            meta: {
              type: 'object',
              properties: {
                request_id: { type: 'string' },
                timestamp: { type: 'string' },
                version: { type: 'string' }
              }
            }
          }
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            status: { type: 'integer' },
            message: { type: 'string' },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  message: { type: 'string' }
                }
              }
            },
            meta: {
              type: 'object',
              properties: {
                request_id: { type: 'string' },
                timestamp: { type: 'string' }
              }
            }
          }
        }
      }
    },
    security: [{ BearerAuth: [] }],
  },
  apis: ['./src/routes/*.js'],
};

const specs = swaggerJsdoc(options);

module.exports = { specs };
