// --- Arquivo: server.js ---

// Polyfill para compatibilidade com versões antigas do Node.js
if (typeof global.TextEncoder === 'undefined') {
    const { TextEncoder } = require('util');
    global.TextEncoder = TextEncoder;
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const qrcode = require('qrcode');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');

const app = express();
const port = process.env.PORT || 3000;
const startTime = Date.now();
const APP_VERSION = require('./package.json').version;

// --- Middlewares de Segurança ---

// Trust proxy (necessário para rate limiting atrás de Traefik/Nginx)
app.set('trust proxy', 1);

// 3C - Helmet: headers HTTP de segurança
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
        }
    },
    crossOriginEmbedderPolicy: false,
}));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 3A - Rate Limiting: 100 requisições por IP a cada 15 minutos
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Muitas requisições. Tente novamente em 15 minutos.',
        retryAfter: '15 minutos'
    }
});

app.use('/api/', apiLimiter);


// --- Schemas de Validação (3B - Zod) ---

const generateSchema = z.object({
    pixKey: z.string().min(1, 'Chave PIX é obrigatória'),
    beneficiaryName: z.string().min(1, 'Nome do beneficiário é obrigatório'),
    beneficiaryCity: z.string().min(1, 'Cidade do beneficiário é obrigatória'),
    amount: z.union([z.number(), z.string()]).optional().nullable(),
    txid: z.string().max(25).optional().nullable(),
    type: z.enum(['static', 'dynamic']).optional().default('static'),
    format: z.enum(['png', 'svg']).optional().default('png'),
});

const validateSchema = z.object({
    brcode: z.string().min(1, 'BR Code é obrigatório'),
});


// --- Funções de Lógica do PIX ---

const normalizeText = (text) => {
    if (!text) return '';
    return text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .replace(/[^A-Z0-9 ]/g, '')
        .trim();
};

const formatField = (id, value) => {
    const length = value.length.toString().padStart(2, '0');
    return `${id}${length}${value}`;
};

const crc16 = (payload) => {
    let crc = 0xFFFF;
    for (let i = 0; i < payload.length; i++) {
        crc ^= payload.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) {
            crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
        }
    }
    return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
};

// 2B - Parser de BR Code (EMV)
const parseBRCode = (brcode) => {
    const fields = {};
    let i = 0;
    while (i < brcode.length - 4) { // -4 para ignorar CRC
        const id = brcode.substring(i, i + 2);
        const len = parseInt(brcode.substring(i + 2, i + 4), 10);
        if (isNaN(len) || len < 0 || i + 4 + len > brcode.length) break;
        const value = brcode.substring(i + 4, i + 4 + len);
        fields[id] = value;
        i += 4 + len;
    }

    // Extrai sub-campos do Merchant Account Info (campo 26)
    let pixKey = null;
    let pixUrl = null;
    if (fields['26']) {
        let j = 0;
        const mai = fields['26'];
        while (j < mai.length) {
            const subId = mai.substring(j, j + 2);
            const subLen = parseInt(mai.substring(j + 2, j + 4), 10);
            if (isNaN(subLen) || subLen < 0 || j + 4 + subLen > mai.length) break;
            const subValue = mai.substring(j + 4, j + 4 + subLen);
            if (subId === '01') pixKey = subValue;  // Chave PIX (estático)
            if (subId === '25') pixUrl = subValue;  // URL da cobrança (dinâmico)
            j += 4 + subLen;
        }
    }

    // Extrai TXID do campo 62
    let txid = null;
    if (fields['62']) {
        let j = 0;
        const ad = fields['62'];
        while (j < ad.length) {
            const subId = ad.substring(j, j + 2);
            const subLen = parseInt(ad.substring(j + 2, j + 4), 10);
            if (isNaN(subLen) || subLen < 0 || j + 4 + subLen > ad.length) break;
            const subValue = ad.substring(j + 4, j + 4 + subLen);
            if (subId === '05') txid = subValue;
            j += 4 + subLen;
        }
    }

    // Detecção de tipo: campo 01 ("11"=estático, "12"=dinâmico) ou presença de URL
    const pointOfInitiation = fields['01'] || null;
    const isDynamic = pointOfInitiation === '12' || !!pixUrl;

    return {
        formatIndicator: fields['00'],
        pointOfInitiation,
        pixKey: pixKey || pixUrl || null,
        pixUrl,
        merchantCategoryCode: fields['52'],
        transactionCurrency: fields['53'] === '986' ? 'BRL' : fields['53'],
        amount: fields['54'] || null,
        countryCode: fields['58'],
        beneficiaryName: fields['59'],
        beneficiaryCity: fields['60'],
        txid,
        type: isDynamic ? 'dynamic' : 'static',
        crc: brcode.substring(brcode.length - 4),
    };
};


// --- Rotas da API ---

// 4A - Health Check
app.get('/health', (req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    res.status(200).json({
        status: 'ok',
        version: APP_VERSION,
        uptime: `${uptime}s`,
        timestamp: new Date().toISOString(),
    });
});

// POST /api/generate - Gera BR Code + QR Code
app.post('/api/generate', async (req, res) => {
    try {
        // 3B - Validação com Zod
        const validation = generateSchema.safeParse(req.body);
        if (!validation.success) {
            const errors = validation.error.errors.map(e => ({
                field: e.path.join('.'),
                message: e.message
            }));
            return res.status(400).json({ error: 'Dados inválidos', details: errors });
        }

        const { pixKey, beneficiaryName, beneficiaryCity, amount, txid: userTxid, type, format } = validation.data;

        const cleanPixKey = pixKey.replace(/\s/g, '');
        const normalizedName = normalizeText(beneficiaryName).substring(0, 25);
        const normalizedCity = normalizeText(beneficiaryCity).substring(0, 15);

        // 2A - PIX Estático vs Dinâmico
        let txid;
        if (type === 'dynamic') {
            txid = userTxid && userTxid.trim() !== '' ? userTxid.replace(/\s/g, '').substring(0, 25) : 'TXID' + Date.now().toString().slice(-8);
        } else {
            txid = userTxid && userTxid.trim() !== '' ? userTxid.replace(/\s/g, '').substring(0, 25) : '***';
        }

        const formattedAmount = amount ? parseFloat(amount).toFixed(2) : null;

        // PIX Dinâmico EXIGE valor
        if (type === 'dynamic' && !formattedAmount) {
            return res.status(400).json({ error: 'PIX Dinâmico requer um valor (amount).' });
        }

        const gui = formatField('00', 'BR.GOV.BCB.PIX');
        const keyField = formatField('01', cleanPixKey);
        const merchantAccountInfo = formatField('26', gui + keyField);
        const merchantCategoryCode = '52040000';
        const transactionCurrency = '5303986';
        const amountField = formattedAmount ? formatField('54', formattedAmount) : '';
        const countryCode = '5802BR';
        const beneficiaryNameField = formatField('59', normalizedName);
        const beneficiaryCityField = formatField('60', normalizedCity);
        const txidField = formatField('05', txid);
        const additionalDataField = formatField('62', txidField);

        let payload = '000201' +
            merchantAccountInfo +
            merchantCategoryCode +
            transactionCurrency +
            amountField +
            countryCode +
            beneficiaryNameField +
            beneficiaryCityField +
            additionalDataField +
            '6304';

        const finalPayload = payload + crc16(payload);

        // 2E - Formato SVG ou PNG
        let qrCodeData;
        if (format === 'svg') {
            qrCodeData = await qrcode.toString(finalPayload, { type: 'svg', width: 360 });
        } else {
            qrCodeData = await qrcode.toDataURL(finalPayload, { width: 360 });
        }

        res.status(200).json({
            brcode: finalPayload,
            qrCodeBase64: format === 'png' ? qrCodeData : undefined,
            qrCodeSvg: format === 'svg' ? qrCodeData : undefined,
            format,
            type,
        });

    } catch (error) {
        console.error('Erro ao gerar o código PIX:', error);
        res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });
    }
});

// 2B - POST /api/validate - Valida e decodifica um BR Code
app.post('/api/validate', (req, res) => {
    try {
        const validation = validateSchema.safeParse(req.body);
        if (!validation.success) {
            const errors = validation.error.errors.map(e => ({
                field: e.path.join('.'),
                message: e.message
            }));
            return res.status(400).json({ error: 'Dados inválidos', details: errors });
        }

        const { brcode } = validation.data;

        // Verifica CRC
        const payloadWithoutCRC = brcode.substring(0, brcode.length - 4);
        const expectedCRC = crc16(payloadWithoutCRC);
        const actualCRC = brcode.substring(brcode.length - 4);
        const crcValid = expectedCRC === actualCRC;

        const parsed = parseBRCode(brcode);

        res.status(200).json({
            valid: crcValid,
            crcExpected: expectedCRC,
            crcReceived: actualCRC,
            data: parsed,
        });

    } catch (error) {
        console.error('Erro ao validar BR Code:', error);
        res.status(500).json({ error: 'Erro ao decodificar o BR Code. Verifique se o formato está correto.' });
    }
});


// --- Swagger (4B) ---
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const swaggerSpec = {
    openapi: '3.0.0',
    info: {
        title: 'VimaPIX API',
        version: APP_VERSION,
        description: 'API para geração e validação de QR Codes e payloads PIX (BR Code)',
        contact: { name: 'VimaPIX', url: 'https://github.com/reisdiegoss/vimapix' }
    },
    servers: [{ url: '/', description: 'Servidor atual' }],
    paths: {
        '/health': {
            get: {
                summary: 'Health Check',
                tags: ['Sistema'],
                responses: {
                    '200': {
                        description: 'Status do servidor',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        status: { type: 'string', example: 'ok' },
                                        version: { type: 'string', example: '1.2.0' },
                                        uptime: { type: 'string', example: '3600s' },
                                        timestamp: { type: 'string', example: '2026-03-02T18:00:00.000Z' },
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/generate': {
            post: {
                summary: 'Gerar QR Code PIX',
                tags: ['PIX'],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['pixKey', 'beneficiaryName', 'beneficiaryCity'],
                                properties: {
                                    pixKey: { type: 'string', description: 'Chave PIX', example: 'teste@email.com' },
                                    beneficiaryName: { type: 'string', description: 'Nome do beneficiário', example: 'FULANO DE TAL' },
                                    beneficiaryCity: { type: 'string', description: 'Cidade do beneficiário', example: 'SAO PAULO' },
                                    amount: { type: 'number', description: 'Valor (opcional)', example: 19.99 },
                                    txid: { type: 'string', description: 'ID da transação (opcional)', example: 'PEDIDO123' },
                                    type: { type: 'string', enum: ['static', 'dynamic'], description: 'Tipo de PIX', example: 'static' },
                                    format: { type: 'string', enum: ['png', 'svg'], description: 'Formato do QR Code', example: 'png' },
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'QR Code gerado com sucesso' },
                    '400': { description: 'Dados inválidos' },
                    '429': { description: 'Rate limit excedido' },
                    '500': { description: 'Erro interno' },
                }
            }
        },
        '/api/validate': {
            post: {
                summary: 'Validar e decodificar BR Code',
                tags: ['PIX'],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['brcode'],
                                properties: {
                                    brcode: { type: 'string', description: 'Payload BR Code completo', example: '00020126...' },
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'BR Code decodificado' },
                    '400': { description: 'Dados inválidos' },
                    '500': { description: 'Erro ao decodificar' },
                }
            }
        }
    }
};

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'VimaPIX - API Docs'
}));


// Rota raiz
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Servidor ---
app.listen(port, () => {
    console.log(`VimaPIX v${APP_VERSION} rodando em http://localhost:${port}`);
    console.log(`Documentação da API: http://localhost:${port}/docs`);
});