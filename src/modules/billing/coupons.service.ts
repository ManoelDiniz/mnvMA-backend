import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common'
import type { EntityManager } from 'typeorm'
import { TenantType } from '../../common/enums/tenant.enum'
import { Tenant } from '../tenants/entities/tenant.entity'
import { User } from '../users/entities/user.entity'
import { Coupon } from './entities/coupon.entity'
import { CouponRedemption, CouponRedemptionStatus } from './entities/coupon-redemption.entity'
import { CouponTarget } from './entities/coupon-target.entity'
import { Plan } from './entities/plan.entity'
import {
  SubscriptionPayment,
  SubscriptionPaymentStatus,
} from './entities/subscription-payment.entity'

/**
 * Piso do que dá para cobrar no cartão.
 *
 * Um cupom de 99% sobre um plano de R$ 49,90 daria R$ 0,50 — abaixo do que o
 * provedor aceita, e a assinatura falharia no checkout com uma mensagem do
 * Mercado Pago que ninguém entende. Melhor recusar aqui, dizendo o que é.
 */
const VALOR_MINIMO_CENTAVOS = 100

/** 100% não é "quase de graça": é um caminho diferente, sem cartão. */
export const CORTESIA = 100

export interface DadosDeAvaliacao {
  codigo: string
  conta: Tenant
  usuario: User
  plano: Plan
}

/**
 * As regras de cupom, num lugar só.
 *
 * Recebe sempre o `EntityManager` de quem chamou em vez de abrir o seu: metade
 * das chamadas vem de uma requisição autenticada (resgatar, pré-visualizar) e
 * metade de fora dela (webhook consumindo fatura, job encerrando cortesia). Um
 * serviço que decidisse sozinho onde a transação começa não serviria aos dois.
 *
 * Uma regra atravessa o arquivo: **o resgate congela o benefício**. Percentual
 * e quantidade de faturas são copiados para a linha de resgate, e é dela que
 * todo o resto lê. Editar ou desligar o cupom depois muda o que acontece com
 * quem ainda vai resgatar, nunca com quem já resgatou.
 */
@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name)

  // ─── Avaliação ──────────────────────────────────────────────────────────────

  /**
   * Confere se o código vale para esta conta, neste plano, agora — sem efeito
   * colateral nenhum. É o que a tela chama enquanto a pessoa digita, e é a
   * mesma função que o resgate chama antes de gravar.
   *
   * Cada recusa tem código próprio porque cada uma tem uma saída diferente:
   * "expirado" é fim de linha, "é para outra conta" pede conferir o e-mail,
   * "já usado" pede olhar a assinatura.
   */
  async avaliar(manager: EntityManager, dados: DadosDeAvaliacao): Promise<Coupon> {
    const codigo = normalizarCodigo(dados.codigo)

    const cupom = await manager.getRepository(Coupon).findOne({ where: { code: codigo } })

    // Inexistente e desligado respondem igual: o código de um cupom circula por
    // WhatsApp, e não custa nada a quem tem o código certo. O que não pode é
    // esta rota virar um oráculo que confirma quais códigos existem.
    if (!cupom || !cupom.isActive) {
      throw new BadRequestException({
        code: 'CUPOM_INVALIDO',
        message: 'Cupom inválido. Confira o código.',
      })
    }

    const agora = new Date()

    if (cupom.startsAt && cupom.startsAt > agora) {
      throw new BadRequestException({
        code: 'CUPOM_AINDA_NAO_VALE',
        message: `Este cupom começa a valer em ${formatarData(cupom.startsAt)}.`,
      })
    }

    if (cupom.expiresAt && cupom.expiresAt <= agora) {
      throw new BadRequestException({
        code: 'CUPOM_EXPIRADO',
        message: 'Este cupom não está mais valendo.',
      })
    }

    if (cupom.tenantType && cupom.tenantType !== dados.conta.type) {
      throw new BadRequestException({
        code: 'CUPOM_OUTRO_TIPO_DE_CONTA',
        message:
          cupom.tenantType === TenantType.COMPANY
            ? 'Este cupom é só para contas de empresa.'
            : 'Este cupom é só para contas individuais.',
      })
    }

    await this.conferirRestricao(manager, cupom, dados)
    await this.conferirUsoAnterior(manager, cupom, dados.conta.id)
    await this.conferirPrimeiraAssinatura(manager, cupom, dados.conta.id)
    await this.conferirTeto(manager, cupom)

    this.conferirValorMinimo(cupom, dados.plano)

    return cupom
  }

  /**
   * O cupom é restrito? Só quem está na lista entra.
   *
   * A ausência de alvos é o que torna o cupom aberto — sem coluna de
   * configuração para alguém marcar errado. O alvo pode ser o e-mail de quem
   * está resgatando (campanha feita antes de a pessoa ter conta) ou a própria
   * conta (desconto combinado com um cliente que já está aqui).
   */
  private async conferirRestricao(
    manager: EntityManager,
    cupom: Coupon,
    dados: DadosDeAvaliacao,
  ): Promise<void> {
    const alvos = await manager.getRepository(CouponTarget).count({
      where: { couponId: cupom.id },
    })
    if (alvos === 0) return

    const permitido = await manager
      .getRepository(CouponTarget)
      .createQueryBuilder('t')
      .where('t.couponId = :couponId', { couponId: cupom.id })
      .andWhere('(t.email = :email OR t.targetTenantId = :tenantId)', {
        email: dados.usuario.email.trim().toLowerCase(),
        tenantId: dados.conta.id,
      })
      .andWhere('t.deletedAt IS NULL')
      .getExists()

    if (!permitido) {
      throw new BadRequestException({
        code: 'CUPOM_RESTRITO',
        message:
          'Este cupom é nominal e está reservado para outra pessoa. Se ele foi enviado para você, confira se está entrando com o mesmo e-mail que recebeu o convite.',
      })
    }
  }

  /** Cada cupom, uma vez por conta. */
  private async conferirUsoAnterior(
    manager: EntityManager,
    cupom: Coupon,
    tenantId: string,
  ): Promise<void> {
    const anterior = await manager.getRepository(CouponRedemption).findOne({
      where: { couponId: cupom.id, tenantId },
    })

    if (!anterior || anterior.status === CouponRedemptionStatus.CANCELED) return

    // PENDING é a pessoa voltando ao checkout que abandonou: não é uso repetido,
    // é a mesma tentativa continuando. Deixar passar é o que evita o beco sem
    // saída de "resgatei, fechei o navegador, agora o cupom diz que já usei".
    if (anterior.status === CouponRedemptionStatus.PENDING) return

    throw new ConflictException({
      code: 'CUPOM_JA_USADO',
      message:
        anterior.status === CouponRedemptionStatus.ACTIVE
          ? 'Este cupom já está valendo na sua conta.'
          : 'Esta conta já usou este cupom.',
    })
  }

  private async conferirPrimeiraAssinatura(
    manager: EntityManager,
    cupom: Coupon,
    tenantId: string,
  ): Promise<void> {
    if (!cupom.firstSubscriptionOnly) return

    const jaPagou = await manager.getRepository(SubscriptionPayment).exists({
      where: { tenantId, status: SubscriptionPaymentStatus.APPROVED },
    })

    if (jaPagou) {
      throw new BadRequestException({
        code: 'CUPOM_SO_PRIMEIRA_ASSINATURA',
        message: 'Este cupom vale só para a primeira assinatura da conta.',
      })
    }
  }

  private async conferirTeto(manager: EntityManager, cupom: Coupon): Promise<void> {
    if (cupom.maxRedemptions === null || cupom.maxRedemptions === undefined) return

    const usados = await this.resgatesValidos(manager, cupom.id)
    if (usados >= cupom.maxRedemptions) {
      throw new ConflictException({
        code: 'CUPOM_ESGOTADO',
        message: 'Este cupom já atingiu o limite de usos.',
      })
    }
  }

  private conferirValorMinimo(cupom: Coupon, plano: Plan): void {
    if (cupom.discountPercent >= CORTESIA) return

    const comDesconto = precoComDesconto(plano.priceCents, cupom.discountPercent)
    if (comDesconto < VALOR_MINIMO_CENTAVOS) {
      throw new BadRequestException({
        code: 'CUPOM_VALOR_MINIMO',
        message:
          'O desconto deixaria a mensalidade abaixo do mínimo que o cartão aceita. Escolha outro plano ou fale com o suporte.',
      })
    }
  }

  private resgatesValidos(manager: EntityManager, couponId: string): Promise<number> {
    return manager
      .getRepository(CouponRedemption)
      .createQueryBuilder('r')
      .where('r.couponId = :couponId', { couponId })
      .andWhere('r.status <> :cancelado', { cancelado: CouponRedemptionStatus.CANCELED })
      .andWhere('r.deletedAt IS NULL')
      .getCount()
  }

  // ─── Resgate ────────────────────────────────────────────────────────────────

  /**
   * Grava o uso do cupom.
   *
   * A conferência do teto acontece com a linha do cupom travada
   * (`SELECT … FOR UPDATE`): sem isso, duas contas resgatando no mesmo segundo
   * o último lugar de uma campanha de cem passariam as duas pela contagem e
   * virariam cento e uma. A trava é curta — dura o resto desta transação.
   *
   * O resgate nasce `PENDING` e só vira `ACTIVE` quando a assinatura ativa de
   * verdade. Cortesia é a exceção: como não passa por checkout, já nasce
   * valendo.
   */
  async resgatar(
    manager: EntityManager,
    dados: DadosDeAvaliacao & { subscriptionId: string },
  ): Promise<CouponRedemption> {
    const cupom = await this.avaliar(manager, dados)

    // Trava a linha do cupom até o fim da transação. Reconferir o teto DEPOIS
    // da trava é o que fecha a corrida — a conferência de `avaliar` é a que dá
    // a mensagem bonita; esta é a que garante o número.
    await manager
      .getRepository(Coupon)
      .createQueryBuilder('c')
      .setLock('pessimistic_write')
      .where('c.id = :id', { id: cupom.id })
      .getOne()

    await this.conferirTeto(manager, cupom)

    const repo = manager.getRepository(CouponRedemption)
    const existente = await repo.findOne({ where: { couponId: cupom.id, tenantId: dados.conta.id } })

    const cortesia = cupom.discountPercent >= CORTESIA
    const agora = new Date()

    if (existente) {
      // Retomada de checkout abandonado: mesma linha, dados atualizados. Criar
      // outra esbarraria na chave única — que é justamente o que se quer.
      await repo.update(existente.id, {
        discountPercent: cupom.discountPercent,
        maxInvoices: cupom.maxInvoices,
        subscriptionId: dados.subscriptionId,
        userId: dados.usuario.id,
        redeemedAt: agora,
      })
      return repo.findOneOrFail({ where: { id: existente.id } })
    }

    const resgate = await repo.save(
      repo.create({
        tenantId: dados.conta.id,
        couponId: cupom.id,
        userId: dados.usuario.id,
        subscriptionId: dados.subscriptionId,
        discountPercent: cupom.discountPercent,
        maxInvoices: cupom.maxInvoices,
        status: CouponRedemptionStatus.PENDING,
        redeemedAt: agora,
      }),
    )

    this.logger.log(
      { tenantId: dados.conta.id, cupom: cupom.code, percentual: cupom.discountPercent, cortesia },
      'cupom resgatado',
    )

    return repo.findOneOrFail({ where: { id: resgate.id } })
  }

  // ─── Ciclo de vida ──────────────────────────────────────────────────────────

  /** O resgate que está valendo (ou esperando o checkout) nesta conta. */
  emVigor(manager: EntityManager, tenantId: string): Promise<CouponRedemption | null> {
    return manager
      .getRepository(CouponRedemption)
      .createQueryBuilder('r')
      // O `eager` da entidade não vale em query builder, e sem o cupom junto a
      // tela mostraria o desconto sem dizer de qual código ele veio.
      .leftJoinAndSelect('r.coupon', 'c')
      .where('r.tenantId = :tenantId', { tenantId })
      .andWhere('r.status IN (:...situacoes)', {
        situacoes: [CouponRedemptionStatus.PENDING, CouponRedemptionStatus.ACTIVE],
      })
      .andWhere('r.deletedAt IS NULL')
      .orderBy('r.redeemedAt', 'DESC')
      .getOne()
  }

  /** Só o que já está descontando de verdade. */
  ativo(manager: EntityManager, tenantId: string): Promise<CouponRedemption | null> {
    return manager.getRepository(CouponRedemption).findOne({
      where: { tenantId, status: CouponRedemptionStatus.ACTIVE },
    })
  }

  /**
   * Liga a cortesia: sem cobrança, sem cartão, com prazo.
   *
   * O prazo sai de `maxInvoices` — num cupom de 100%, "3 faturas" quer dizer
   * "3 ciclos de graça". A conta fica ACTIVE até lá e o job de cobrança avisa
   * quando estiver perto do fim.
   */
  async ativarCortesia(
    manager: EntityManager,
    resgate: CouponRedemption,
    plano: Plan,
    agora = new Date(),
  ): Promise<Date> {
    const ciclos = resgate.maxInvoices * Math.max(1, plano.intervalCount)
    const fim = adicionarMeses(agora, ciclos)

    await manager.getRepository(CouponRedemption).update(resgate.id, {
      status: CouponRedemptionStatus.ACTIVE,
      activatedAt: agora,
      endsAt: fim,
      warnedStage: 0,
    })

    return fim
  }

  /**
   * A assinatura paga ativou. Dois efeitos, e o segundo é fácil de esquecer:
   * o resgate pendente passa a valer, e uma cortesia que ainda estivesse de pé
   * se encerra — quem converteu para plano pago não continua de graça.
   */
  async aoAtivarAssinatura(
    manager: EntityManager,
    tenantId: string,
    subscriptionId: string,
  ): Promise<void> {
    const repo = manager.getRepository(CouponRedemption)

    const pendente = await repo.findOne({
      where: { tenantId, status: CouponRedemptionStatus.PENDING },
    })

    if (pendente) {
      await repo.update(pendente.id, {
        status: CouponRedemptionStatus.ACTIVE,
        activatedAt: new Date(),
        subscriptionId,
      })
    }

    const cortesias = await repo.find({
      where: { tenantId, status: CouponRedemptionStatus.ACTIVE },
    })

    for (const cortesia of cortesias) {
      if (cortesia.discountPercent < CORTESIA) continue
      if (pendente && cortesia.id === pendente.id) continue

      await repo.update(cortesia.id, {
        status: CouponRedemptionStatus.EXHAUSTED,
        endsAt: new Date(),
      })
      this.logger.log({ tenantId }, 'cortesia encerrada: a conta passou a plano pago')
    }
  }

  /**
   * Uma fatura saiu com desconto. Devolve `true` quando essa era a última —
   * é o gatilho para o valor da assinatura voltar ao cheio no provedor.
   *
   * Cortesia não passa por aqui: ela não gera fatura nenhuma.
   */
  async consumirFatura(
    manager: EntityManager,
    tenantId: string,
  ): Promise<{ resgate: CouponRedemption; esgotou: boolean } | null> {
    const resgate = await this.ativo(manager, tenantId)
    if (!resgate || resgate.discountPercent >= CORTESIA) return null

    const usadas = resgate.invoicesUsed + 1
    const esgotou = usadas >= resgate.maxInvoices

    await manager.getRepository(CouponRedemption).update(resgate.id, {
      invoicesUsed: usadas,
      ...(esgotou
        ? { status: CouponRedemptionStatus.EXHAUSTED, endsAt: new Date() }
        : {}),
    })

    if (esgotou) {
      this.logger.log(
        { tenantId, faturas: usadas },
        'desconto do cupom acabou — a próxima cobrança volta ao valor cheio',
      )
    }

    return { resgate, esgotou }
  }

  /** Encerra a cortesia vencida. O que acontece com a conta é do job. */
  async encerrarCortesia(manager: EntityManager, resgate: CouponRedemption): Promise<void> {
    await manager.getRepository(CouponRedemption).update(resgate.id, {
      status: CouponRedemptionStatus.EXHAUSTED,
      warnedStage: 3,
    })
  }
}

// ─── Funções puras ────────────────────────────────────────────────────────────

/** `bemvindo50` e `  BemVindo50 ` são o mesmo cupom. */
export function normalizarCodigo(codigo: string): string {
  return codigo.trim().toUpperCase()
}

/**
 * Preço em centavos depois do desconto.
 *
 * Arredonda para o centavo mais próximo, em inteiro: 33% de R$ 49,90 em ponto
 * flutuante daria 3343.299999999999, e o centavo perdido reaparece na
 * conciliação com o extrato do provedor.
 */
export function precoComDesconto(precoCentavos: number, percentual: number): number {
  if (percentual >= CORTESIA) return 0
  return Math.round((precoCentavos * (100 - percentual)) / 100)
}

/**
 * Mesma aritmética do vencimento da assinatura: preserva o dia e cai no último
 * dia do mês quando o dia não existe (31 de janeiro + 1 mês = 28 de fevereiro).
 */
export function adicionarMeses(data: Date, meses: number): Date {
  const resultado = new Date(data)
  const dia = resultado.getUTCDate()
  resultado.setUTCMonth(resultado.getUTCMonth() + meses)
  if (resultado.getUTCDate() < dia) resultado.setUTCDate(0)
  return resultado
}

function formatarData(data: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(data)
}
