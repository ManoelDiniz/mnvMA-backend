import { BadRequestException, Injectable } from '@nestjs/common'
import {
  InjectTenantRepository,
  TenantScopedRepository,
} from '../../common/database/tenant-scoped.repository'
import { PageDto } from '../../common/dto/pagination.dto'
import { StorageService, type ArquivoRecebido } from '../../common/storage/storage.service'
import { dataLocal, diasEntre, somarDias } from '../../common/utils/calendar'
import { Caregiver } from '../caregivers/entities/caregiver.entity'
import {
  CaregiverDocument,
  DocumentStatus,
  DocumentType,
} from './entities/caregiver-document.entity'
import type {
  CreateDocumentDto,
  DocumentQueryDto,
  DocumentResponseDto,
  UpdateDocumentDto,
} from './dto/document.dto'

/** Janela de aviso. 30 dias é o prazo típico para renovar um atestado. */
export const DIAS_DE_AVISO = 30

export const ROTULOS_TIPO: Record<DocumentType, string> = {
  [DocumentType.RG]: 'RG',
  [DocumentType.CPF]: 'CPF',
  [DocumentType.CNH]: 'CNH',
  [DocumentType.COREN]: 'COREN',
  [DocumentType.PROOF_OF_ADDRESS]: 'Comprovante de residência',
  [DocumentType.COURSE_CERTIFICATE]: 'Certificado de curso',
  [DocumentType.HEALTH_CERTIFICATE]: 'Atestado de saúde',
  [DocumentType.CRIMINAL_RECORD]: 'Antecedentes criminais',
  [DocumentType.VACCINATION]: 'Carteira de vacinação',
  [DocumentType.CONTRACT]: 'Contrato',
  [DocumentType.OTHER]: 'Outro',
}

@Injectable()
export class DocumentsService {
  constructor(
    @InjectTenantRepository(CaregiverDocument)
    private readonly documents: TenantScopedRepository<CaregiverDocument>,
    @InjectTenantRepository(Caregiver)
    private readonly caregivers: TenantScopedRepository<Caregiver>,
    private readonly storage: StorageService,
  ) {}

  // ─── Arquivo ────────────────────────────────────────────────────────────────

  /**
   * Anexa (ou troca) o arquivo do documento.
   *
   * Trocar remove o anterior do armazenamento: guardar as duas versões seria
   * acumular documento pessoal de gente sem que ninguém consiga chegar nele
   * pela tela — o pior dos dois mundos, custo e risco sem utilidade.
   */
  async anexarArquivo(id: string, arquivo: ArquivoRecebido): Promise<DocumentResponseDto> {
    const doc = await this.documents.findByIdOrFail(id, {}, 'Documento não encontrado.')
    const anterior = doc.fileKey

    const guardado = await this.storage.guardar(
      this.documents.tenantId,
      `caregivers/${doc.caregiverId}/documents/${doc.id}`,
      arquivo,
    )

    await this.documents.updateById(id, {
      fileKey: guardado.key,
      fileName: guardado.fileName,
      mimeType: guardado.mimeType,
      fileSize: guardado.size,
      fileUploadedAt: new Date(),
    })

    // Só depois de a nova chave estar gravada: se a remoção viesse antes e a
    // gravação falhasse, o documento ficaria sem arquivo nenhum.
    if (anterior && anterior !== guardado.key) await this.storage.remover(anterior)

    return this.findOne(id)
  }

  async removerArquivo(id: string): Promise<DocumentResponseDto> {
    const doc = await this.documents.findByIdOrFail(id, {}, 'Documento não encontrado.')

    if (doc.fileKey) {
      await this.documents.updateById(id, {
        fileKey: null,
        fileName: null,
        mimeType: null,
        fileSize: null,
        fileUploadedAt: null,
      })
      await this.storage.remover(doc.fileKey)
    }

    return this.findOne(id)
  }

  /**
   * Preenche o link de download de cada documento que tem arquivo.
   *
   * Assinar é conta local nos dois drivers — HMAC no disco, SigV4 no bucket —,
   * então uma lista de 200 documentos não vira 200 idas à rede.
   */
  private async comLinks(dtos: DocumentResponseDto[]): Promise<DocumentResponseDto[]> {
    return Promise.all(
      dtos.map(async (dto) =>
        dto.fileKey
          ? { ...dto, fileUrl: await this.storage.urlAssinada(dto.fileKey, dto.fileName ?? undefined) }
          : dto,
      ),
    )
  }

  async list(query: DocumentQueryDto): Promise<PageDto<DocumentResponseDto>> {
    const hoje = dataLocal()
    const limite = somarDias(hoje, DIAS_DE_AVISO)

    const qb = this.documents.qb('d').leftJoinAndSelect('d.caregiver', 'cuidador')

    if (query.caregiverId) qb.andWhere('d.caregiverId = :cui', { cui: query.caregiverId })
    if (query.type) qb.andWhere('d.type = :tipo', { tipo: query.type })

    if (query.situation === 'expired') {
      qb.andWhere('d.expiresAt IS NOT NULL AND d.expiresAt < :hoje', { hoje })
    } else if (query.situation === 'expiring') {
      qb.andWhere('d.expiresAt IS NOT NULL AND d.expiresAt >= :hoje AND d.expiresAt <= :limite', {
        hoje,
        limite,
      })
    } else if (query.situation === 'pending') {
      qb.andWhere('d.expiresAt IS NOT NULL AND d.expiresAt <= :limite', { limite })
    }

    if (query.q) {
      qb.andWhere('(cuidador.name LIKE :busca OR d.label LIKE :busca OR d.number LIKE :busca)', {
        busca: `%${query.q}%`,
      })
    }

    // Sem validade vai para o fim: quem abre esta tela quer ver o que está
    // vencendo, não a lista de RGs.
    //
    // `limit`/`offset` e não `take`/`skip`: com um join na consulta, take/skip
    // fazem o TypeORM montar uma subconsulta de ids distintos, e nela ele tenta
    // ler o `ORDER BY` como `alias.propriedade` — o CASE acima vira "alias
    // 'CASE WHEN d' não encontrado" e a rota devolve 500. Como `caregiver` é
    // ManyToOne, uma linha por documento, o LIMIT direto é equivalente e seguro.
    const [dados, total] = await qb
      .orderBy('CASE WHEN d.expiresAt IS NULL THEN 1 ELSE 0 END', 'ASC')
      .addOrderBy('d.expiresAt', 'ASC')
      .addOrderBy('cuidador.name', 'ASC')
      .offset(query.skip)
      .limit(query.perPage)
      .getManyAndCount()

    return new PageDto(
      dados.map((d) => paraResposta(d, hoje)),
      total,
      query,
    )
  }

  /**
   * Vencendo nos próximos N dias **ou já vencido**. Base do job diário e do
   * alerta do painel. Só cuidador ativo: quem saiu da equipe não é problema.
   */
  async expiring(days: number): Promise<DocumentResponseDto[]> {
    const hoje = dataLocal()
    const limite = somarDias(hoje, days)

    const docs = await this.documents
      .qb('d')
      .innerJoinAndSelect('d.caregiver', 'cuidador')
      .andWhere('d.expiresAt IS NOT NULL AND d.expiresAt <= :limite', { limite })
      .andWhere('cuidador.isActive = 1')
      .orderBy('d.expiresAt', 'ASC')
      .take(200)
      .getMany()

    return this.comLinks(docs.map((d) => paraResposta(d, hoje)))
  }

  async findOne(id: string): Promise<DocumentResponseDto> {
    const doc = await this.documents.findByIdOrFail(
      id,
      { relations: { caregiver: true } },
      'Documento não encontrado.',
    )
    const [comLink] = await this.comLinks([paraResposta(doc, dataLocal())])
    return comLink
  }

  async create(caregiverId: string, dto: CreateDocumentDto): Promise<DocumentResponseDto> {
    await this.caregivers.findByIdOrFail(caregiverId, {}, 'Cuidador não encontrado.')
    this.validar(dto)

    const doc = await this.documents.createAndSave({
      caregiverId,
      type: dto.type,
      label: dto.label ?? null,
      number: dto.number ?? null,
      issuedAt: dto.issuedAt ?? null,
      expiresAt: dto.expiresAt ?? null,
      fileKey: dto.fileKey ?? null,
      fileName: dto.fileName ?? null,
      notes: dto.notes ?? null,
    })

    return this.findOne(doc.id)
  }

  async update(id: string, dto: UpdateDocumentDto): Promise<DocumentResponseDto> {
    const atual = await this.documents.findByIdOrFail(id, {}, 'Documento não encontrado.')

    this.validar({
      type: dto.type ?? atual.type,
      label: dto.label !== undefined ? dto.label : (atual.label ?? undefined),
      issuedAt: dto.issuedAt !== undefined ? dto.issuedAt : (atual.issuedAt ?? undefined),
      expiresAt: dto.expiresAt !== undefined ? dto.expiresAt : (atual.expiresAt ?? undefined),
    })

    await this.documents.updateById(id, {
      ...(dto.type !== undefined ? { type: dto.type } : {}),
      ...(dto.label !== undefined ? { label: dto.label ?? null } : {}),
      ...(dto.number !== undefined ? { number: dto.number ?? null } : {}),
      ...(dto.issuedAt !== undefined ? { issuedAt: dto.issuedAt ?? null } : {}),
      ...(dto.expiresAt !== undefined ? { expiresAt: dto.expiresAt ?? null } : {}),
      ...(dto.fileKey !== undefined ? { fileKey: dto.fileKey ?? null } : {}),
      ...(dto.fileName !== undefined ? { fileName: dto.fileName ?? null } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes ?? null } : {}),
    })

    return this.findOne(id)
  }

  async remove(id: string): Promise<void> {
    await this.documents.softDeleteById(id)
  }

  private validar(dto: {
    type: DocumentType
    label?: string
    issuedAt?: string
    expiresAt?: string
  }): void {
    if (dto.type === DocumentType.OTHER && !dto.label?.trim()) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Dê um nome ao documento.',
        fields: { label: 'Dê um nome ao documento.' },
      })
    }

    if (dto.issuedAt && dto.expiresAt && dto.expiresAt < dto.issuedAt) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'A validade não pode ser anterior à emissão.',
        fields: { expiresAt: 'A validade não pode ser anterior à emissão.' },
      })
    }
  }
}

/**
 * Situação é DERIVADA da data, nunca coluna.
 *
 * Guardar "VENCIDO" numa coluna significa que um documento só vence quando
 * alguém roda um job — e o dia em que o job falha é o dia em que a empresa
 * escala um cuidador com atestado vencido.
 */
export function situacaoDe(
  expiresAt: string | null | undefined,
  hoje: string,
): { status: DocumentStatus; daysToExpire: number | null } {
  if (!expiresAt) return { status: DocumentStatus.PERMANENT, daysToExpire: null }

  const dias = diasEntre(hoje, expiresAt)

  if (dias < 0) return { status: DocumentStatus.EXPIRED, daysToExpire: dias }
  if (dias <= DIAS_DE_AVISO) return { status: DocumentStatus.EXPIRING, daysToExpire: dias }
  return { status: DocumentStatus.VALID, daysToExpire: dias }
}

function paraResposta(d: CaregiverDocument, hoje: string): DocumentResponseDto {
  const { status, daysToExpire } = situacaoDe(d.expiresAt, hoje)

  return {
    id: d.id,
    caregiverId: d.caregiverId,
    caregiverName: d.caregiver?.name ?? '',
    type: d.type,
    title: d.type === DocumentType.OTHER ? (d.label ?? 'Documento') : ROTULOS_TIPO[d.type],
    label: d.label ?? null,
    number: d.number ?? null,
    issuedAt: d.issuedAt ?? null,
    expiresAt: d.expiresAt ?? null,
    fileKey: d.fileKey ?? null,
    fileName: d.fileName ?? null,
    mimeType: d.mimeType ?? null,
    fileSize: d.fileSize ?? null,
    fileUploadedAt: d.fileUploadedAt ?? null,
    // Preenchido depois, por `comLinks`: assinar é assíncrono e este mapeamento
    // precisa continuar sendo função pura, testável sem armazenamento nenhum.
    fileUrl: null,
    notes: d.notes ?? null,
    status,
    daysToExpire,
  }
}
