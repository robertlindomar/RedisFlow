import type { NextConfig } from 'next';

const configuracao: NextConfig = {
  output: process.env.GERAR_DOCKER === '1' ? 'standalone' : undefined,
  poweredByHeader: false,
  serverExternalPackages: ['pg', 'redis'],
};

export default configuracao;
