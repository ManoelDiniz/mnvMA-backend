import {
  competenciaMenorOuIgual,
  dataLocal,
  horaLocal,
  paraUtc,
  diaDaCompetencia,
  diasEntre,
  diasNoMes,
  proximaCompetencia,
  somarDias,
} from './calendar'

describe('diasEntre', () => {
  it('conta dias corridos', () => {
    expect(diasEntre('2026-08-25', '2026-08-30')).toBe(5)
    expect(diasEntre('2026-08-30', '2026-08-25')).toBe(-5)
  })

  it('atravessa a virada do horário de verão sem erro de arredondamento', () => {
    expect(diasEntre('2026-02-14', '2026-02-15')).toBe(1)
    expect(diasEntre('2026-10-17', '2026-10-18')).toBe(1)
  })

  it('atravessa ano bissexto', () => {
    expect(diasEntre('2028-02-28', '2028-03-01')).toBe(2)
    expect(diasEntre('2026-02-28', '2026-03-01')).toBe(1)
  })
})

describe('somarDias', () => {
  it('vira o mês e o ano', () => {
    expect(somarDias('2026-12-30', 3)).toBe('2027-01-02')
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('proximaCompetencia', () => {
  it('vira o ano em dezembro', () => {
    expect(proximaCompetencia('2026-12')).toBe('2027-01')
    expect(proximaCompetencia('2026-08')).toBe('2026-09')
  })
})

describe('diasNoMes', () => {
  it('conhece fevereiro bissexto', () => {
    expect(diasNoMes('2026-02')).toBe(28)
    expect(diasNoMes('2028-02')).toBe(29)
    expect(diasNoMes('2026-04')).toBe(30)
  })
})

describe('diaDaCompetencia', () => {
  it('não transborda para o mês seguinte', () => {
    expect(diaDaCompetencia('2026-02', 31)).toBe('2026-02-28')
    expect(diaDaCompetencia('2026-04', 31)).toBe('2026-04-30')
    expect(diaDaCompetencia('2026-08', 5)).toBe('2026-08-05')
  })
})

describe('competenciaMenorOuIgual', () => {
  it('ordena competências como texto', () => {
    expect(competenciaMenorOuIgual('2026-08', '2026-09')).toBe(true)
    expect(competenciaMenorOuIgual('2026-12', '2027-01')).toBe(true)
    expect(competenciaMenorOuIgual('2027-01', '2026-12')).toBe(false)
  })
})

describe('paraUtc / dataLocal', () => {
  it('converte hora local do Brasil para UTC e volta', () => {
    const inicio = paraUtc('2026-09-01', '07:00')
    expect(inicio.toISOString()).toBe('2026-09-01T10:00:00.000Z')
    expect(dataLocal(inicio)).toBe('2026-09-01')
    expect(horaLocal(inicio)).toBe('07:00')
  })

  it('mantém o plantão noturno no dia em que começa', () => {
    const inicio = paraUtc('2026-09-01', '19:00')
    // 22:00Z ainda é dia 1 em São Paulo.
    expect(inicio.toISOString()).toBe('2026-09-01T22:00:00.000Z')
    expect(dataLocal(inicio)).toBe('2026-09-01')
  })

  it('não deixa o fim da noite vazar para o dia seguinte', () => {
    // 23h local = 02:00Z do dia seguinte. Sem conversão, o relatório jogaria
    // este plantão no dia errado.
    const tarde = paraUtc('2026-09-01', '23:00')
    expect(tarde.toISOString()).toBe('2026-09-02T02:00:00.000Z')
    expect(dataLocal(tarde)).toBe('2026-09-01')
  })
})
