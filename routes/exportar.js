const express  = require('express');
const router   = express.Router();
const db       = require('../config/db');
const ExcelJS  = require('exceljs');
const PDFKit   = require('pdfkit');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.use(requireAuth);
router.use(requireAdmin);

async function getTickets(filtros) {
    let query = `
        SELECT t.*, a.nombre as area_nombre,
        TIMESTAMPDIFF(HOUR, t.fecha_creacion, IFNULL(t.fecha_cierre, NOW())) as horas_total
        FROM tickets t
        LEFT JOIN areas a ON t.area_actual_id = a.id
        WHERE 1=1
    `;
    const params = [];

    if (filtros.estado === 'cerrados') {
        query += ` AND t.estado IN ('Cerrada','Resuelta')`;
    } else if (filtros.estado) {
        query += ` AND t.estado = ?`;
        params.push(filtros.estado);
    }
    if (filtros.prioridad) {
        query += ` AND t.prioridad = ?`;
        params.push(filtros.prioridad);
    }
    if (filtros.area) {
        query += ` AND t.area_actual_id = ?`;
        params.push(filtros.area);
    }
    if (filtros.fecha_desde) {
        query += ` AND t.fecha_creacion >= ?`;
        params.push(filtros.fecha_desde);
    }
    if (filtros.fecha_hasta) {
        query += ` AND t.fecha_creacion <= ?`;
        params.push(filtros.fecha_hasta + ' 23:59:59');
    }
    if (filtros.dias_abierto) {
        query += ` AND TIMESTAMPDIFF(DAY, t.fecha_creacion, NOW()) >= ? AND t.estado NOT IN ('Cerrada','Resuelta')`;
        params.push(parseInt(filtros.dias_abierto));
    }

    query += ` ORDER BY t.fecha_creacion DESC`;

    const [tickets] = await db.execute(query, params);
    return tickets;
}

// Exportar a Excel
router.get('/excel', async (req, res) => {
    try {
        const tickets = await getTickets(req.query);
        console.log('Filtros:', req.query);
        console.log('Tickets encontrados:', tickets.length);

        const workbook  = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Tickets');

        worksheet.columns = [
            { header: 'Código',        key: 'codigo',            width: 15 },
            { header: 'Título',        key: 'titulo',            width: 35 },
            { header: 'Cliente',       key: 'nombre_cliente',    width: 20 },
            { header: 'Email',         key: 'email_cliente',     width: 25 },
            { header: 'Teléfono',      key: 'telefono_cliente',  width: 15 },
            { header: 'Estado',        key: 'estado',            width: 15 },
            { header: 'Prioridad',     key: 'prioridad',         width: 12 },
            { header: 'Área',          key: 'area_nombre',       width: 20 },
            { header: 'Fecha',         key: 'fecha_creacion',    width: 20 },
            { header: 'Horas abierto', key: 'horas_total',       width: 15 },
        ];

        worksheet.getRow(1).fill = {
            type: 'pattern', pattern: 'solid',
            fgColor: { argb: 'FF1A56DB' }
        };
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

        tickets.forEach(t => {
            worksheet.addRow({
                codigo:           t.codigo,
                titulo:           t.titulo,
                nombre_cliente:   t.nombre_cliente,
                email_cliente:    t.email_cliente   || '—',
                telefono_cliente: t.telefono_cliente || '—',
                estado:           t.estado,
                prioridad:        t.prioridad,
                area_nombre:      t.area_nombre     || 'Sin asignar',
                fecha_creacion:   new Date(t.fecha_creacion).toLocaleString('es-ES'),
                horas_total:      t.horas_total + 'h'
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=tickets.xlsx');
        res.send(buffer);

    } catch (err) {
        console.error(err);
        res.status(500).send('Error exportando Excel');
    }
});

// Exportar a PDF
router.get('/pdf', async (req, res) => {
    try {
        const tickets = await getTickets(req.query);

        const doc = new PDFKit({ margin: 40, size: 'A4', layout: 'landscape' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=tickets.pdf');
        doc.pipe(res);

        doc.fontSize(18).fillColor('#1a56db').text('Reporte de Tickets', { align: 'center' });
        doc.fontSize(10).fillColor('#64748b').text(`Generado: ${new Date().toLocaleString('es-ES')} — Total: ${tickets.length} tickets`, { align: 'center' });
        doc.moveDown();

        const headers   = ['Código', 'Título', 'Cliente', 'Estado', 'Prioridad', 'Área', 'Horas'];
        const colWidths = [80, 180, 100, 80, 70, 100, 50];
        let x = 40;
        const y = doc.y;

        doc.fillColor('#1a56db');
        headers.forEach((h, i) => {
            doc.rect(x, y, colWidths[i], 20).fill();
            doc.fillColor('white').fontSize(9).text(h, x + 4, y + 6, { width: colWidths[i] - 8 });
            x += colWidths[i];
        });

        doc.moveDown(1.5);

        tickets.forEach((t, idx) => {
            if (doc.y > 500) { doc.addPage(); }
            x = 40;
            const rowY = doc.y;
            const rowData = [
                t.codigo,
                t.titulo.substring(0, 28),
                t.nombre_cliente,
                t.estado,
                t.prioridad,
                (t.area_nombre || 'Sin asignar').substring(0, 15),
                t.horas_total + 'h'
            ];

            doc.fillColor(idx % 2 === 0 ? '#f8fafc' : 'white');
            doc.rect(40, rowY, colWidths.reduce((a, b) => a + b, 0), 18).fill();

            rowData.forEach((d, i) => {
                doc.fillColor('#334155').fontSize(8).text(String(d), x + 4, rowY + 5, { width: colWidths[i] - 8 });
                x += colWidths[i];
            });

            doc.y = rowY + 18;
        });

        doc.end();

    } catch (err) {
        console.error(err);
        res.status(500).send('Error exportando PDF');
    }
});

module.exports = router;