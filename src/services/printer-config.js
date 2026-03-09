const { app } = require('electron')
const path = require('path')

// Printer configuration
const PRINTER_CONFIG = {
  default: {
    silent: true,
    printBackground: true,
    landscape: false,
    marginsType: 0, // 0=default, 1=none, 2=minimal
    scaleFactor: 100,
    pagesPerSheet: 1,
    collate: true,
    color: true,
    duplexMode: 'simplex', // simplex, shortEdge, longEdge
    copies: 1
  },
  thermal: {
    silent: true,
    deviceName: '', // Will be auto-detected or configured
    pageSize: 'custom'
  }
}

// Get available printers
const getPrinters = () => {
  const { webContents } = require('electron')
  const printers = webContents.getPrinters()
  return printers
}

// Find default printer
const getDefaultPrinter = () => {
  const printers = getPrinters()
  const defaultPrinter = printers.find(p => p.isDefault)
  return defaultPrinter || printers[0]
}

// Find printer by name
const findPrinterByName = (name) => {
  const printers = getPrinters()
  return printers.find(p => p.name === name || p.displayName === name)
}

module.exports = {
  PRINTER_CONFIG,
  getPrinters,
  getDefaultPrinter,
  findPrinterByName
}
